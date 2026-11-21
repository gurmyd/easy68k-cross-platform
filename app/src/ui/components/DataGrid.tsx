// Table with a selected row and an active cell (ARCHITECTURE.md 2.2, 2.6):
// the editor's message list (Line / Error Message), the Break Points
// panel's grids, the Log panel. Owner: W2.
//
// A `grid` that keeps the focus on itself and points at the active cell with
// aria-activedescendant. Keys: Up / Down, Page Up / Page Down, Ctrl+Home /
// Ctrl+End move the row; Left / Right, Home / End the column; Enter or F2
// (and a double-click) call onActivate(row, column) - the message list goes
// to the line, the Break Points grids start editing.
//
// In-place editing: the caller sets `editing` and supplies renderEditor,
// which renders an input into that cell and ends the edit itself (Enter,
// Escape, blur) by clearing `editing`; the grid takes the focus back.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import '../../styles/components.css';
import './DataGrid.css';
import { moveIndex } from './roving';
import { rowsPerPage } from './virtual';

export interface DataGridColumn<R> {
  id: string;
  header: string;
  /** CSS grid track: '64px', '1fr', 'minmax(120px, 1fr)'. Default '1fr'. */
  width?: string;
  align?: 'start' | 'end' | 'center';
  /** Monospaced cell text (addresses, values, line numbers). */
  mono?: boolean;
  /** Cell content; default String(row[id]). */
  render?: (row: R, rowIndex: number) => ReactNode;
}

export interface DataGridProps<R> {
  /** Accessible name ('Assembler messages'). */
  label: string;
  columns: readonly DataGridColumn<R>[];
  rows: readonly R[];
  rowKey: (row: R, index: number) => string;
  selectedRow: number;
  onSelectRow: (index: number) => void;
  onActivate?: (rowIndex: number, columnIndex: number) => void;
  /** A first column with 1-based row numbers (the Break Points grids). */
  rowNumbers?: boolean;
  /** Tool-tip of a row (the message list shows the message's text, editor-ui §7). */
  rowTitle?: (row: R, index: number) => string | undefined;
  editing?: { row: number; column: number } | null;
  renderEditor?: (row: R, rowIndex: number, columnIndex: number) => ReactNode;
  /** Height of the scrolling area (CSS length); default: as tall as the rows. */
  height?: number | string;
  /** Shown when there are no rows. */
  emptyText?: string;
  className?: string;
}

const ROW_HEIGHT = 22;

export function DataGrid<R>({
  label,
  columns,
  rows,
  rowKey,
  selectedRow,
  onSelectRow,
  onActivate,
  rowNumbers = false,
  rowTitle,
  editing = null,
  renderEditor,
  height,
  emptyText,
  className,
}: DataGridProps<R>) {
  const baseId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [column, setColumn] = useState(0);
  const activeColumn = Math.min(column, Math.max(0, columns.length - 1));
  const cellId = (row: number, col: number) => `${baseId}-r${row}c${col}`;
  const tracks = [rowNumbers ? '44px' : null, ...columns.map((c) => c.width ?? '1fr')].filter(Boolean).join(' ');

  // Keep the selected row in view; take the focus back after an edit.
  const wasEditing = useRef(false);
  useEffect(() => {
    const body = bodyRef.current;
    const row = body?.querySelector<HTMLElement>(`[data-row="${selectedRow}"]`);
    if (body && row) {
      const top = row.offsetTop - body.offsetTop;
      if (top < body.scrollTop) body.scrollTop = top;
      else if (top + row.offsetHeight > body.scrollTop + body.clientHeight) {
        body.scrollTop = top + row.offsetHeight - body.clientHeight;
      }
    }
    if (wasEditing.current && !editing) gridRef.current?.focus({ preventScroll: true });
    wasEditing.current = Boolean(editing);
  }, [selectedRow, editing]);

  const isEditingCell = (r: number, c: number) => editing?.row === r && editing.column === c && renderEditor;

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={label}
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length + (rowNumbers ? 1 : 0)}
      aria-activedescendant={
        rows.length > 0 && selectedRow >= 0 && !editing ? cellId(selectedRow, activeColumn) : undefined
      }
      tabIndex={0}
      data-e68-enter=""
      className={className ? `e68-grid ${className}` : 'e68-grid'}
      onKeyDown={(event) => {
        if (event.target !== gridRef.current || rows.length === 0) return;
        const page = rowsPerPage(bodyRef.current?.clientHeight ?? ROW_HEIGHT * 5, ROW_HEIGHT);
        const current = Math.max(0, selectedRow);
        let nextRow: number | null = null;
        let nextColumn: number | null = null;
        switch (event.key) {
          case 'ArrowDown':
          case 'ArrowUp':
            nextRow = moveIndex(rows.length, selectedRow, event.key, { orientation: 'vertical', wrap: false });
            break;
          case 'PageDown':
            nextRow = Math.min(rows.length - 1, current + page);
            break;
          case 'PageUp':
            nextRow = Math.max(0, current - page);
            break;
          case 'Home':
          case 'End':
            if (event.ctrlKey || event.metaKey) nextRow = event.key === 'Home' ? 0 : rows.length - 1;
            else nextColumn = event.key === 'Home' ? 0 : columns.length - 1;
            break;
          case 'ArrowLeft':
          case 'ArrowRight':
            nextColumn = moveIndex(columns.length, activeColumn, event.key, { orientation: 'horizontal', wrap: false });
            break;
          case 'Enter':
          case 'F2':
            if (onActivate && selectedRow >= 0) {
              event.preventDefault();
              onActivate(selectedRow, activeColumn);
            }
            return;
          default:
            return;
        }
        event.preventDefault();
        if (nextRow !== null && nextRow !== selectedRow) onSelectRow(nextRow);
        if (nextColumn !== null) setColumn(nextColumn);
      }}
    >
      <div role="rowgroup" className="e68-grid__head">
        <div role="row" aria-rowindex={1} className="e68-grid__row" style={{ gridTemplateColumns: tracks }}>
          {rowNumbers && (
            <div role="columnheader" className="e68-grid__header e68-grid__rownumber">
              <span className="e68-sr">Row</span>
            </div>
          )}
          {columns.map((col) => (
            <div
              key={col.id}
              role="columnheader"
              className={`e68-grid__header e68-grid__cell--${col.align ?? 'start'}`}
            >
              {col.header}
            </div>
          ))}
        </div>
      </div>
      <div
        ref={bodyRef}
        role="rowgroup"
        className="e68-grid__body"
        style={height !== undefined ? { height } : undefined}
      >
        {rows.length === 0 && emptyText && (
          <div role="row" className="e68-grid__row">
            <div role="gridcell" className="e68-grid__empty" aria-colspan={columns.length + (rowNumbers ? 1 : 0)}>
              {emptyText}
            </div>
          </div>
        )}
        {rows.map((row, r) => (
          <div
            key={rowKey(row, r)}
            role="row"
            aria-rowindex={r + 2}
            aria-selected={r === selectedRow}
            data-row={r}
            title={rowTitle?.(row, r)}
            className="e68-grid__row"
            style={{ gridTemplateColumns: tracks }}
          >
            {rowNumbers && (
              <div role="rowheader" className="e68-grid__rownumber">
                {r + 1}
              </div>
            )}
            {columns.map((col, c) => (
              <div
                key={col.id}
                id={cellId(r, c)}
                role="gridcell"
                className={[
                  'e68-grid__cell',
                  `e68-grid__cell--${col.align ?? 'start'}`,
                  col.mono ? 'e68-grid__cell--mono' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-active={r === selectedRow && c === activeColumn ? 'true' : undefined}
                onPointerDown={(event) => {
                  if (event.button !== 0 || isEditingCell(r, c)) return;
                  gridRef.current?.focus({ preventScroll: true });
                  if (r !== selectedRow) onSelectRow(r);
                  setColumn(c);
                }}
                onDoubleClick={() => onActivate?.(r, c)}
              >
                {isEditingCell(r, c)
                  ? renderEditor?.(row, r, c)
                  : col.render
                    ? col.render(row, r)
                    : String((row as Record<string, unknown>)[col.id] ?? '')}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
