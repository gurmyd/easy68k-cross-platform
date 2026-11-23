// The dialog `history.versions`, Earlier Versions (ARCHITECTURE-PLUS P3.3.8). Owner: N4.
//
// Modal. The list of the file's versions (the kit's DataGrid, newest first: Kept, Size, Kind), the
// comparison of the selected version (left) with the file now (right; the unified view below
// 700 px of dialog width), and the buttons Restore, Open as New Document and Close. The
// comparison is @codemirror/merge, loaded with import() (merge-view.ts) when the dialog first
// shows one. The list follows changes from this window and others (`subscribe`).

import { useEffect, useRef, useState } from 'react';
import type { DialogProps, VersionInfo, VPath } from '../../contracts';
import { formatSize } from '../../core/history/size';
import { basename } from '../../core/paths/winpath';
import { useAppContext } from '../../state/context';
import { Button, DataGrid, Dialog, type DataGridColumn } from '../../ui/components';
import { fontFamilyFor, fontSizeFor } from '../../ui/editor/fonts';
import type { Comparison, mountComparison } from './merge-view';
import { openAsNewDocument } from './open-as-new';
import { HistoryProblem, Lines, useHistoryChanges } from './shared';
import {
  CLOSE_BUTTON,
  COMPARISON_LABEL,
  NOW_HEADING,
  OPEN_AS_NEW_BUTTON,
  REASON_SHOWN_AS,
  RESTORE_BUTTON,
  VERSIONS_COLUMNS,
  VERSIONS_LIST_LABEL,
  versionsTitle,
} from './texts';
import {
  comparisonText,
  describeVersions,
  documentAt,
  formatKept,
  loadVersions,
  newDocumentText,
  problemsOf,
  restoreVersion,
  type UntrackedReason,
} from './versions';

export interface VersionsDialogProps {
  path: VPath;
}

/** Below this width of the dialog the comparison is the unified view (P3.3.8). */
export const UNIFIED_BELOW_PX = 700;

/** What this dialog uses of merge-view.ts (a type only: the module itself is loaded with import()). */
interface MergeModule {
  mountComparison: typeof mountComparison;
}

/** The merge view's module, loaded once on first use (it stays out of the first load). */
let mergeModule: Promise<MergeModule> | null = null;
const loadMerge = () => (mergeModule ??= import('./merge-view'));

const COLUMNS: DataGridColumn<VersionInfo>[] = [
  { id: 'time', header: VERSIONS_COLUMNS.kept, width: 'minmax(160px, 2fr)', render: (row) => formatKept(row.time) },
  {
    id: 'size',
    header: VERSIONS_COLUMNS.size,
    width: 'minmax(80px, 1fr)',
    align: 'end',
    render: (row) => formatSize(row.size),
  },
  {
    id: 'reason',
    header: VERSIONS_COLUMNS.kind,
    width: 'minmax(120px, 2fr)',
    render: (row) => REASON_SHOWN_AS[row.reason],
  },
];

export function VersionsDialog({ props, close }: DialogProps<VersionsDialogProps, void>) {
  const ctx = useAppContext();
  const history = ctx.history;
  const path = props.path;
  const changes = useHistoryChanges(history);
  const [rows, setRows] = useState<VersionInfo[]>([]);
  const [reason, setReason] = useState<UntrackedReason>(null);
  const [now, setNow] = useState<Uint8Array | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState(0);
  const selectedSeq = useRef<number | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [unified, setUnified] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  // The list, the reason of `untracked` and the file now; again on every change of the history.
  useEffect(() => {
    if (!history) return;
    let live = true;
    void loadVersions({ history, vfs: ctx.vfs }, path).then((result) => {
      if (!live) return;
      setRows(result.rows);
      setReason(result.reason);
      setNow(result.now);
      setLoaded(true);
      // Keep the selected version selected when the list changes; else the one at the same place.
      setSelected((current) => {
        const seq = selectedSeq.current;
        const keep = seq === null ? -1 : result.rows.findIndex((row) => row.seq === seq);
        return keep >= 0 ? keep : Math.min(current, Math.max(0, result.rows.length - 1));
      });
    });
    return () => {
      live = false;
    };
  }, [history, ctx.vfs, path, changes, reloads]);

  const row = rows[selected] ?? null;
  selectedSeq.current = row ? row.seq : null;

  // The selected version's text.
  useEffect(() => {
    if (!history || !row) {
      setBefore(null);
      return;
    }
    let live = true;
    history.read(path, row.seq).then(
      (bytes) => live && setBefore(comparisonText(bytes)),
      () => live && setBefore(null),
    );
    return () => {
      live = false;
    };
  }, [history, path, row]);

  // The dialog's width decides the view (side by side, or unified below 700 px).
  useEffect(() => {
    const body = bodyRef.current;
    const box = body?.closest<HTMLElement>('[role=dialog]') ?? body;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const measure = () => setUnified(box.getBoundingClientRect().width < UNIFIED_BELOW_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // The comparison itself.
  const active = ctx.documents.active();
  const font = documentAt(ctx.documents, path) ?? active;
  const fontFamily = fontFamilyFor(font?.fontName ?? 'Courier New');
  const fontSize = fontSizeFor(font?.fontSize ?? 10);
  const beforeLabel = row ? formatKept(row.time) : '';
  const nowText = comparisonText(now);
  useEffect(() => {
    const parent = viewRef.current;
    if (!parent || before === null) return;
    let comparison: Comparison | null = null;
    let live = true;
    void loadMerge().then((module) => {
      if (!live) return;
      parent.replaceChildren();
      comparison = module.mountComparison(parent, {
        before,
        now: nowText,
        unified,
        fontFamily,
        fontSize,
        beforeLabel,
        nowLabel: NOW_HEADING,
      });
    });
    return () => {
      live = false;
      comparison?.destroy();
    };
  }, [before, nowText, unified, fontFamily, fontSize, beforeLabel]);

  const state = history?.state() ?? 'unavailable';
  const problems = history ? problemsOf(history) : { unreadable: 0, detail: '' };
  const view = describeVersions({
    state,
    unreadable: problems.unreadable,
    detail: problems.detail,
    rows,
    reason,
  });

  const restore = async () => {
    if (!history || !row || busy) return;
    setBusy(true);
    try {
      const outcome = await restoreVersion(
        { history, dialogs: ctx.dialogs, documents: ctx.documents, vfs: ctx.vfs },
        path,
        row.seq,
      );
      if (outcome === 'gone') setReloads((n) => n + 1);
      if (outcome === 'restored') setReloads((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const openAsNew = () => {
    if (before === null) return;
    openAsNewDocument(ctx, newDocumentText(before));
    close(undefined);
  };

  const showList = view.kind === 'list' && view.rows.length > 0;
  return (
    <Dialog
      title={versionsTitle(basename(path))}
      onCancel={() => close(undefined)}
      width="min(1000px, calc(100vw - 32px))"
      className="e68-history"
      footer={
        <>
          <Button caption={RESTORE_BUTTON} disabled={!showList || !row || busy} onClick={() => void restore()} />
          <Button caption={OPEN_AS_NEW_BUTTON} disabled={!showList || before === null} onClick={openAsNew} />
          <span className="e68-history__spacer" />
          <Button caption={CLOSE_BUTTON} isDefault onClick={() => close(undefined)} />
        </>
      }
    >
      <div
        ref={bodyRef}
        className="e68-history__body"
        data-e68-history="versions"
        data-loaded={loaded ? 'true' : undefined}
      >
        {view.kind === 'unavailable' ? (
          <HistoryProblem ctx={ctx} text={view.text} />
        ) : (
          <>
            <Lines lines={view.lines} />
            {view.empty !== null && (
              <p className="e68-history__empty" role="status">
                {view.empty}
              </p>
            )}
            {showList && (
              <>
                <DataGrid
                  label={VERSIONS_LIST_LABEL}
                  columns={COLUMNS}
                  rows={view.rows}
                  rowKey={(version) => String(version.seq)}
                  selectedRow={selected}
                  onSelectRow={setSelected}
                  height={132}
                  className="e68-history__grid"
                />
                <section className="e68-history__compare" aria-label={COMPARISON_LABEL}>
                  <div className="e68-history__headings" data-unified={unified ? 'true' : undefined}>
                    <span className="e68-history__heading e68-history__heading--before">{beforeLabel}</span>
                    <span className="e68-history__heading e68-history__heading--now">{NOW_HEADING}</span>
                  </div>
                  <div ref={viewRef} className="e68-history__view" data-unified={unified ? 'true' : undefined} />
                </section>
              </>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
