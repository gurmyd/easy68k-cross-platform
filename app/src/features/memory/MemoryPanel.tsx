// The Memory panel (ARCHITECTURE.md 2.6; sim-ui §10). Owner: U2.
//
// Layout as the original window and the sketch of 2.3: a top strip with `Address:`, `From:`, `To:`,
// `Bytes:`, `Copy`, `Fill`, `Save`; below it the column header aligned with the rows;
// the rows; a right strip with `Row`, `Page` and `Live`. The number of rows follows the panel
// height; the panel pages, it does not scroll. The cursor is a one-cell frame that blinks at
// 500 ms while the rows have the keyboard focus (static under prefers-reduced-motion, 2.11).
//
// All behaviour is in model.ts and rules.ts; this component measures, renders and forwards events.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import {
  ADDRESS_FIELD,
  Button,
  Checkbox,
  IconButton,
  MaskedField,
  revealInArea,
  type MaskedConfig,
} from '../../ui/components';
import { useAppContext } from '../../state/context';
import { memoryModelOf } from './model';
import { COLUMN_HEADER, cellAddress, type MemoryRow } from './rules';
import './memory.css';

/** The Bytes field: eight hex digits (mask 'aaaaaaaa;0;0'). */
const BYTES_FIELD: MaskedConfig = { kind: 'hex', width: 8 };

/** $7F is shown "as itself" by the original; Courier New has no glyph for it and draws a box. */
const DEL_GLYPH = '□';
const showable = (text: string) => text.replace(/\x7f/g, DEL_GLYPH);

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function Row({ row }: { row: MemoryRow }) {
  return (
    <div className="e68-memory__row" data-invalid={row.addressInvalid ? 'true' : undefined}>
      <span className="e68-memory__addr">{row.addressText}</span>
      <span className="e68-memory__hex">{row.hex.join('')}</span>
      <span className="e68-memory__ascii">{showable(row.ascii.join(''))}</span>
    </div>
  );
}

export function MemoryPanel() {
  const ctx = useAppContext();
  const model = memoryModelOf(ctx);
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const rowsRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [rowsFocused, setRowsFocused] = useState(false);
  const reveal = (event: FocusEvent<HTMLDivElement>) => revealInArea(event.currentTarget, event.target);
  const [cell, setCell] = useState({ width: 8, height: 16 });
  const statusId = useId();
  const fieldIds = { address: useId(), from: useId(), to: useId(), bytes: useId() };

  // Character cell size and the number of rows that fit (nRows = client height / row height).
  useLayoutEffect(() => {
    const rows = rowsRef.current;
    const measure = measureRef.current;
    if (!rows || !measure) return;
    const update = () => {
      const box = measure.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return; // hidden behind another tab: keep the old values
      const size = { width: box.width / 10, height: box.height };
      setCell((old) => (old.width === size.width && old.height === size.height ? old : size));
      model.setRows(Math.floor(rows.clientHeight / size.height));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(rows);
    return () => observer.disconnect();
  }, [model]);

  // The panel shows what memory holds now when it is shown.
  useEffect(() => {
    model.repaint();
  }, [model]);

  const onRowsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      if (event.key === 'PageUp') model.pageUp();
      else model.pageDown();
      return;
    }
    if (ARROWS.has(event.key)) {
      event.preventDefault();
      model.moveCursor(event.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight');
      return;
    }
    if (event.key === 'Tab') return;
    const handled = model.typeKey(event.key, { ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey });
    if (handled !== null) event.preventDefault();
  };

  const onAddressKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'PageUp':
        event.preventDefault();
        model.pageUp();
        break;
      case 'PageDown':
        event.preventDefault();
        model.pageDown();
        break;
      case 'ArrowUp':
        event.preventDefault();
        model.rowUp();
        break;
      case 'ArrowDown':
        event.preventDefault();
        model.rowDown();
        break;
      case 'Enter':
        event.preventDefault();
        model.repaint();
        break;
    }
  };

  const cursor =
    state.cursor && state.rows > 0 ? { ...state.cursor, row: Math.min(state.cursor.row, state.rows - 1) } : null;

  // The cursor's cell stays in view while the rows have the focus and the table is scrolled
  // sideways (a panel narrower than a row): the table's own offsets, never scrollIntoView.
  const cursorCol = cursor?.col ?? null;
  const cursorRowIndex = cursor?.row ?? null;
  useLayoutEffect(() => {
    const table = tableRef.current;
    const frame = cursorRef.current;
    if (!table || !frame || cursorCol === null || document.activeElement !== rowsRef.current) return;
    revealInArea(table, frame);
  }, [cursorCol, cursorRowIndex, cell, rowsFocused]);
  const cursorAddress = cursor ? cellAddress(state.address, cursor) : null;
  const cursorRow = cursor ? state.view[cursor.row] : undefined;
  const cursorText =
    cursor && cursorAddress !== null && cursorRow && !cursorRow.addressInvalid
      ? `Address ${cursorAddress.toString(16).toUpperCase().padStart(8, '0')}, value ${cursorRow.hex[cursorAddress - cursorRow.address]?.trim() ?? ''}`
      : '';

  return (
    <div className="e68-memory">
      <div className="e68-memory__main" onFocus={reveal}>
        <div className="e68-memory__strip">
          <MaskedField
            id={fieldIds.address}
            label="Address: $"
            aria-label="Address"
            {...ADDRESS_FIELD}
            prefix="00"
            value={model.addressText}
            onChange={(text) => model.setAddressText(text)}
            onKeyDown={onAddressKeyDown}
            data-e68-panel-focus=""
          />
          <MaskedField
            id={fieldIds.from}
            label="From: $"
            aria-label="From"
            {...ADDRESS_FIELD}
            prefix="00"
            value={state.from}
            onChange={(text) => model.setFrom(text)}
          />
          <MaskedField
            id={fieldIds.to}
            label="To: $"
            aria-label="To"
            {...ADDRESS_FIELD}
            prefix="00"
            value={state.to}
            onChange={(text) => model.setTo(text)}
          />
          <MaskedField
            id={fieldIds.bytes}
            label="Bytes: $"
            aria-label="Bytes"
            {...BYTES_FIELD}
            value={state.bytes}
            onChange={(text) => model.setBytes(text)}
          />
          <Button caption="Copy" size="small" onClick={() => void model.copy()} />
          <Button caption="Fill" size="small" onClick={() => void model.fill()} />
          <IconButton icon="file-save" label="Save" size="small" onClick={() => void model.save()} />
        </div>
        {/* The header and the rows scroll sideways together when the panel is narrower than a
            row (version 1.1): a row always holds 16 bytes, as in the original (sim-ui 10.1). */}
        <div className="e68-memory__table" ref={tableRef} data-memory-table="">
          <div className="e68-memory__header" aria-hidden="true">
            {`${' '.repeat(10)}${COLUMN_HEADER}`}
          </div>
          <div
            ref={rowsRef}
            className="e68-memory__rows"
            role="group"
            aria-label="Memory contents"
            aria-roledescription="memory editor"
            aria-describedby={statusId}
            tabIndex={0}
            onFocus={() => {
              model.ensureCursor();
              setRowsFocused(true);
            }}
            onBlur={() => setRowsFocused(false)}
            onKeyDown={onRowsKeyDown}
            onWheel={(event) => model.wheel(event.deltaY, event.deltaMode)}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              const rows = rowsRef.current;
              if (!rows) return;
              const box = rows.getBoundingClientRect();
              const padding = parseFloat(getComputedStyle(rows).paddingLeft) || 0;
              const x = event.clientX - box.left - padding + rows.scrollLeft;
              const y = event.clientY - box.top;
              event.preventDefault();
              rows.focus({ preventScroll: true });
              model.place({ row: Math.floor(y / cell.height), col: Math.floor(x / cell.width) });
            }}
          >
            <div ref={measureRef} className="e68-memory__row e68-memory__measure" aria-hidden="true">
              WWWWWWWWWW
            </div>
            {state.view.map((row) => (
              <Row key={row.address} row={row} />
            ))}
            {cursor && (
              <div
                ref={cursorRef}
                className="e68-memory__cursor"
                aria-hidden="true"
                style={{
                  left: `calc(var(--sp-1) + ${cursor.col * cell.width}px)`,
                  top: cursor.row * cell.height,
                  width: cell.width,
                  height: cell.height,
                }}
              />
            )}
            <span id={statusId} className="e68-sr" aria-live="polite">
              {cursorText}
            </span>
          </div>
        </div>
      </div>
      <div className="e68-memory__side" onFocus={reveal}>
        <span className="e68-memory__sidelabel">Row</span>
        <IconButton icon="chevron-up" label="Row up" size="small" onClick={() => model.rowUp()} />
        <IconButton icon="chevron-down" label="Row down" size="small" onClick={() => model.rowDown()} />
        <span className="e68-memory__sidelabel">Page</span>
        <IconButton icon="chevron-up" label="Page up" size="small" onClick={() => model.pageUp()} />
        <IconButton icon="chevron-down" label="Page down" size="small" onClick={() => model.pageDown()} />
        <span className="e68-memory__sidelabel">Live</span>
        <Checkbox aria-label="Live" checked={state.live} onChange={(checked) => model.setLive(checked)} />
      </div>
    </div>
  );
}
