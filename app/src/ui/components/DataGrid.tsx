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
//
// Several selected rows (ARCHITECTURE-PLUS P3.2.1, P1.3, P3.3.8: the Trash; added by N4): with
// `multiSelect`, `selectedRow` is the focused row and `multiSelect.selected` the selected rows; the
// grid is aria-multiselectable and each row's aria-selected follows the set. Click selects one row,
// Shift+click the range from the anchor (the row clicked last without Shift), Ctrl+click (macOS
// Cmd+click) adds or removes a row and makes it the anchor. Up / Down (Page Up / Page Down,
// Ctrl+Home / Ctrl+End) select one row as before; with Shift they extend the range from the anchor
// (Shift+Home / Shift+End to the first and last row); Ctrl+Up / Ctrl+Down (macOS Option+Up /
// Option+Down) move the focus without selecting; Ctrl+Space (macOS Option+Space) adds or removes
// the focused row; Ctrl+A (macOS Cmd+A, Ctrl+A) selects every row. The kit does not know the key
// map, so it takes both forms. Without `multiSelect` the grid behaves exactly as before.

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import '../../styles/components.css';
import './DataGrid.css';
import { moveIndex } from './roving';
import { rowsPerPage, scrollTopBelowHeader } from './virtual';

/** A CSS length from a number of px or a CSS length. */
const cssLength = (value: number | string) => (typeof value === 'number' ? `${value}px` : value);

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
  /**
   * Height of the rows' area below the header (CSS length); default: as tall as the rows. The
   * grid element itself scrolls, with the header row kept at its top.
   */
  height?: number | string;
  /** Shown when there are no rows. */
  emptyText?: string;
  className?: string;
  /**
   * Several selected rows (ARCHITECTURE-PLUS P3.2.1, P1.3; added by N4). `selectedRow` is then the
   * focused row. Absent: one selected row, exactly as before.
   */
  multiSelect?: { selected: ReadonlySet<number>; onChange(rows: ReadonlySet<number>): void };
}

const ROW_HEIGHT = 22;

/** The selection of a grid with `multiSelect`: the focused row, the anchor and the selected rows. */
export interface GridMultiState {
  focus: number;
  anchor: number;
  selected: ReadonlySet<number>;
}

/** What a click or a key does to a multi-selection (P3.2.1). */
export type GridMultiStep =
  | { kind: 'click'; row: number; shift: boolean; toggle: boolean }
  | { kind: 'move'; row: number; extend: boolean; focusOnly: boolean }
  | { kind: 'toggle' }
  | { kind: 'all'; rows: number };

const rangeSet = (a: number, b: number): Set<number> => {
  const out = new Set<number>();
  for (let row = Math.min(a, b); row <= Math.max(a, b); row++) out.add(row);
  return out;
};

/** The multi-selection after one step (pure; ARCHITECTURE-PLUS P3.2.1 and P1.3). */
export function gridMultiSelectStep(state: GridMultiState, step: GridMultiStep): GridMultiState {
  const anchor = state.anchor >= 0 ? state.anchor : Math.max(0, state.focus);
  switch (step.kind) {
    case 'click':
      if (step.shift) return { focus: step.row, anchor, selected: rangeSet(anchor, step.row) };
      if (step.toggle) {
        const selected = new Set(state.selected);
        if (selected.has(step.row)) selected.delete(step.row);
        else selected.add(step.row);
        return { focus: step.row, anchor: step.row, selected };
      }
      return { focus: step.row, anchor: step.row, selected: new Set([step.row]) };
    case 'move':
      if (step.focusOnly) return { ...state, focus: step.row };
      if (step.extend) return { focus: step.row, anchor, selected: rangeSet(anchor, step.row) };
      return { focus: step.row, anchor: step.row, selected: new Set([step.row]) };
    case 'toggle': {
      if (state.focus < 0) return state;
      const selected = new Set(state.selected);
      if (selected.has(state.focus)) selected.delete(state.focus);
      else selected.add(state.focus);
      return { ...state, anchor: state.focus, selected };
    }
    case 'all':
      return { ...state, selected: step.rows > 0 ? rangeSet(0, step.rows - 1) : new Set() };
  }
}

/** Same members, in any order. */
const sameSet = (a: ReadonlySet<number>, b: ReadonlySet<number>) => a.size === b.size && [...a].every((x) => b.has(x));

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
  multiSelect,
}: DataGridProps<R>) {
  const baseId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [column, setColumn] = useState(0);
  // The anchor of a multi-selection: the row clicked or moved to last without Shift (P3.2.1).
  const anchorRef = useRef(-1);
  if (anchorRef.current >= rows.length) anchorRef.current = -1;
  /** Applies one step of a multi-selection: the focused row and the selected set follow. */
  const multiStep = (step: GridMultiStep): void => {
    if (!multiSelect) return;
    const next = gridMultiSelectStep(
      { focus: selectedRow, anchor: anchorRef.current, selected: multiSelect.selected },
      step,
    );
    anchorRef.current = next.anchor;
    if (next.focus !== selectedRow) onSelectRow(next.focus);
    if (!sameSet(next.selected, multiSelect.selected)) multiSelect.onChange(next.selected);
  };
  const isSelected = (r: number) => (multiSelect ? multiSelect.selected.has(r) : r === selectedRow);
  const activeColumn = Math.min(column, Math.max(0, columns.length - 1));
  const cellId = (row: number, col: number) => `${baseId}-r${row}c${col}`;
  const tracks = [rowNumbers ? '44px' : null, ...columns.map((c) => c.width ?? '1fr')].filter(Boolean).join(' ');

  // Keep the selected row in view below the sticky header; take the focus back after an edit.
  // The grid element itself scrolls (it holds the focus, so axe's scrollable-region-focusable is
  // met; docs/requests/U3-datagrid-scroll-region.md, errata W2 entry 20).
  const wasEditing = useRef(false);
  useEffect(() => {
    const grid = gridRef.current;
    const body = bodyRef.current;
    const row = body?.querySelector<HTMLElement>(`[data-row="${selectedRow}"]`);
    if (grid && body && row) {
      const next = scrollTopBelowHeader(
        body.offsetTop + row.offsetTop,
        row.offsetHeight,
        grid.scrollTop,
        grid.clientHeight,
        headRef.current?.offsetHeight ?? 0,
      );
      if (next !== grid.scrollTop) grid.scrollTop = next;
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
      aria-multiselectable={multiSelect ? 'true' : undefined}
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length + (rowNumbers ? 1 : 0)}
      aria-activedescendant={
        rows.length > 0 && selectedRow >= 0 && !editing ? cellId(selectedRow, activeColumn) : undefined
      }
      tabIndex={0}
      data-e68-enter=""
      className={className ? `e68-grid ${className}` : 'e68-grid'}
      data-height={height !== undefined ? '' : undefined}
      style={height !== undefined ? ({ '--e68-grid-body-h': cssLength(height) } as CSSProperties) : undefined}
      onKeyDown={(event) => {
        if (event.target !== gridRef.current || rows.length === 0) return;
        const view = gridRef.current
          ? gridRef.current.clientHeight - (headRef.current?.offsetHeight ?? 0)
          : ROW_HEIGHT * 5;
        const page = rowsPerPage(view, ROW_HEIGHT);
        const current = Math.max(0, selectedRow);
        let nextRow: number | null = null;
        let nextColumn: number | null = null;
        if (multiSelect) {
          // The keys of P1.3 for several rows; every other key as without multiSelect.
          const command = event.ctrlKey || event.metaKey;
          if ((event.key === 'a' || event.key === 'A') && command && !event.altKey && !event.shiftKey) {
            event.preventDefault();
            multiStep({ kind: 'all', rows: rows.length });
            return;
          }
          // By the key's position as well: macOS Option+Space reports a no-break space as its key.
          const space = event.key === ' ' || event.code === 'Space';
          if (space && (event.ctrlKey || event.altKey) && !event.shiftKey && !event.metaKey) {
            event.preventDefault();
            multiStep({ kind: 'toggle' });
            return;
          }
          const vertical =
            event.key === 'ArrowDown' || event.key === 'ArrowUp'
              ? moveIndex(rows.length, selectedRow, event.key, { orientation: 'vertical', wrap: false })
              : event.key === 'PageDown'
                ? Math.min(rows.length - 1, current + page)
                : event.key === 'PageUp'
                  ? Math.max(0, current - page)
                  : (event.key === 'Home' || event.key === 'End') && (event.shiftKey || command)
                    ? event.key === 'Home'
                      ? 0
                      : rows.length - 1
                    : null;
          if (vertical !== null) {
            event.preventDefault();
            const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';
            multiStep({
              kind: 'move',
              row: vertical,
              extend: event.shiftKey,
              focusOnly: arrow && !event.shiftKey && (event.ctrlKey || event.altKey),
            });
            return;
          }
        }
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
      <div ref={headRef} role="rowgroup" className="e68-grid__head">
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
        style={height !== undefined ? { minHeight: cssLength(height) } : undefined}
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
            aria-selected={isSelected(r)}
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
                  if (multiSelect) {
                    multiStep({ kind: 'click', row: r, shift: event.shiftKey, toggle: event.ctrlKey || event.metaKey });
                    event.preventDefault();
                  } else if (r !== selectedRow) onSelectRow(r);
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
