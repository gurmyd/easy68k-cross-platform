// The EASyBIN workspace: the original's main window (docs/porting/easybin.md 3-8). Owner: B1.
//
// Top: the `S-Record File` group, the `Binary Input/Output Split` radio group and the `Binary File(s)`
// group; below them From / To, Size + Copy, the fill byte + Fill. Then the Address field and the
// column header, the memory rows, and on the right the Row and Page buttons. The rows are not a
// scrolling list: as in the original the area shows `rows` rows from the Address field's address and
// pages; the model (core/easybin/model.ts) has every rule, this component measures, draws and
// forwards keys, clicks and the wheel.

import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { AppContext } from '../../contracts';
import { byteForCodePoint } from '../../core/codec/cp1252';
import {
  CAPTIONS,
  COLUMN_HEADER,
  FIELD_WIDTHS,
  SPLIT_ITEMS,
  hexText,
  type EasybinFields,
  type EasybinModel,
  type EditableField,
  type Split,
  type ViewRow,
} from '../../core/easybin';
import { useAppContext } from '../../state/context';
import { Button, IconButton, MaskedField, RadioGroup } from '../../ui/components';
import { beep } from './beep';
import { copyBytes, fillBytes } from './commands';
import { easybinOf } from './session';
import './easybin.css';

/** $7F: Courier New has no glyph there and Windows draws a box (docs/porting/easybin.md 5.3). */
const DEL_GLYPH = '□';
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']);

/**
 * The byte a key-down types into the memory area (7.4), or null when the key is not a character for
 * the original's FormKeyPress. Backspace, Enter and Esc are characters there; Ctrl+letter is the
 * control character (Tab moves the focus, and AltGr characters arrive as Ctrl+Alt with their text).
 */
export function keyByte(event: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): number | 'refuse' | null {
  if (event.metaKey) return null;
  if (event.key === 'Backspace') return 0x08;
  if (event.key === 'Enter') return 0x0d;
  if (event.key === 'Escape') return 0x1b;
  const chars = Array.from(event.key);
  if (chars.length !== 1) return null;
  const char = chars[0] as string;
  if (event.ctrlKey && !event.altKey) {
    return /^[a-z]$/i.test(char) ? char.toUpperCase().charCodeAt(0) & 0x1f : null;
  }
  const byte = byteForCodePoint(char.codePointAt(0) as number);
  return byte === null ? 'refuse' : byte;
}

function runCommand(ctx: AppContext, id: string): void {
  void ctx.commands.run(id);
}

const sameCells = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((cell, i) => cell === b[i]);

/**
 * True when two rows draw the same. viewRows() builds new row objects on every change, so without
 * this every key typed would redraw all rows; with it only the row that changed is redrawn, which
 * keeps typing responsive on slow machines (the check measures key-down to painted frame).
 */
export function sameRow(a: ViewRow, b: ViewRow): boolean {
  return (
    a.addressText === b.addressText &&
    a.invalid === b.invalid &&
    sameCells(a.hex, b.hex) &&
    sameCells(a.tones, b.tones) &&
    sameCells(a.ascii, b.ascii)
  );
}

/** A run of neighbouring cells drawn in one colour, as one span. */
export interface CellRun<T> {
  tone: T;
  text: string;
}

function runs<T>(count: number, toneOf: (i: number) => T, textOf: (i: number) => string): CellRun<T>[] {
  const result: CellRun<T>[] = [];
  for (let i = 0; i < count; i++) {
    const tone = toneOf(i);
    const last = result.at(-1);
    if (last && last.tone === tone) last.text += textOf(i);
    else result.push({ tone, text: textOf(i) });
  }
  return result;
}

/**
 * The hex column of a row as runs of one colour: each cell is its two digits and a space (5.2). One
 * span per run instead of one per byte keeps the elements a redrawn row creates few (usually one).
 */
export function hexRuns(row: ViewRow): CellRun<ViewRow['tones'][number]>[] {
  return runs(
    row.hex.length,
    (i) => row.tones[i] as ViewRow['tones'][number],
    (i) => `${row.hex[i]} `,
  );
}

/** The ASCII column of a row as runs: past the end of memory (`invalid`) or not; $7F as a box (5.3). */
export function asciiRuns(row: ViewRow): CellRun<boolean>[] {
  return runs(
    row.ascii.length,
    (i) => row.tones[i] === 'invalid',
    (i) => (row.ascii[i] === '\x7f' ? DEL_GLYPH : (row.ascii[i] as string)),
  );
}

const Row = memo(
  function Row({ row }: { row: ViewRow }) {
    return (
      <div className="e68-easybin__row" data-invalid={row.invalid ? 'true' : undefined}>
        <span className="e68-easybin__addr">{row.addressText}</span>
        {hexRuns(row).map((run, i) => (
          <span key={i} className={`e68-easybin__byte e68-easybin__byte--${run.tone}`}>
            {run.text}
          </span>
        ))}
        <span className="e68-easybin__ascii">
          {asciiRuns(row).map((run, i) => (
            <span key={i} className={run.tone ? 'e68-easybin__byte--invalid' : undefined}>
              {run.text}
            </span>
          ))}
        </span>
      </div>
    );
  },
  (previous, next) => sameRow(previous.row, next.row),
);

/** A drawn row: the rows it was made from and what was made (a React element in the view). */
export interface DrawnRow<T> {
  row: ViewRow;
  item: T;
}

/**
 * The rows to draw, reusing what was made for a row that draws the same at the same index: only a
 * changed row gets a new item. A key typed changes one row, so one row element is created per key
 * instead of one per visible row (React skips a reused element without calling anything; creating
 * elements is the main cost of a key in a development build, see check-easybin.mjs).
 */
export function reuseRows<T>(
  previous: readonly DrawnRow<T>[],
  rows: readonly ViewRow[],
  make: (row: ViewRow, index: number) => T,
): DrawnRow<T>[] {
  return rows.map((row, index) => {
    const old = previous[index];
    return old && sameRow(old.row, row) ? old : { row, item: make(row, index) };
  });
}

/**
 * The rows of the memory area. Redrawn only when the rows change (memory, the address, the number
 * of rows, the colours), not when the cursor moves or a field that does not colour them changes.
 */
const Rows = memo(function Rows({ view }: { view: readonly ViewRow[] }) {
  const drawn = useRef<DrawnRow<ReactElement>[]>([]);
  drawn.current = reuseRows(drawn.current, view, (row, index) => <Row key={index} row={row} />);
  return <>{drawn.current.map((d) => d.item)}</>;
});

/** A read-only value of the `S-Record File` group: `$`, an optional grey `00`, the digits. */
function ReadOnlyValue({ label, value, zeroByte }: { label: string; value: string; zeroByte: boolean }) {
  const id = useId();
  return (
    <div className="e68-easybin__item">
      <span id={id} className="e68-easybin__label">
        {label}
      </span>
      <output aria-labelledby={id} className="e68-easybin__value">
        {CAPTIONS.dollar}
        {zeroByte && (
          <span className="e68-easybin__zero" aria-hidden="true">
            {CAPTIONS.zeroByte}
          </span>
        )}
        {value}
      </output>
    </div>
  );
}

/** The groups and the From / To / Size / fill strip: redrawn only when a field or the split changes. */
const Controls = memo(function Controls({ fields, split }: { fields: EasybinFields; split: Split }) {
  const ctx = useAppContext();
  const { model } = easybinOf(ctx);
  const field = (name: EditableField, label: string, ariaLabel: string, zeroByte: boolean) => {
    const value = fields[name];
    return (
      <MaskedField
        label={label}
        aria-label={ariaLabel}
        kind="hex"
        // A field the program filled with more digits than its mask shows them all (4.1).
        width={Math.max(FIELD_WIDTHS[name], value.length)}
        {...(zeroByte ? { prefix: CAPTIONS.zeroByte } : {})}
        value={value}
        onChange={(text) => model.setField(name, text)}
        onReject={() => beep(ctx)}
        className="e68-easybin__field"
      />
    );
  };

  return (
    <>
      <div className="e68-easybin__top">
        <fieldset className="e68-easybin__group">
          <legend className="e68-easybin__legend">{CAPTIONS.s68Group}</legend>
          <div className="e68-easybin__grid">
            {field('startAddress', `${CAPTIONS.startAddress} ${CAPTIONS.dollar}`, 'Start Address', false)}
            <ReadOnlyValue label={CAPTIONS.lastAddress} value={fields.lastAddress} zeroByte />
            <ReadOnlyValue label={CAPTIONS.length} value={fields.s68Length} zeroByte={false} />
          </div>
          <IconButton
            icon="file-open"
            label="Open S-Record..."
            size="small"
            className="e68-easybin__groupbutton"
            onClick={() => runCommand(ctx, 'bin.file.openSrec')}
          />
        </fieldset>
        <div className="e68-easybin__group e68-easybin__group--radio">
          <RadioGroup<string>
            label={CAPTIONS.splitGroup}
            options={SPLIT_ITEMS.map((item) => ({ value: String(item.split), label: item.caption }))}
            value={String(split)}
            onChange={(value) => model.setSplit(Number(value) as Split)}
          />
        </div>
        <fieldset className="e68-easybin__group">
          <legend className="e68-easybin__legend">{CAPTIONS.binaryGroup}</legend>
          <div className="e68-easybin__grid">
            {field('firstAddress', `${CAPTIONS.firstAddress} ${CAPTIONS.dollar}`, 'First Address', true)}
            {field('outLength', `${CAPTIONS.length} ${CAPTIONS.dollar}`, 'Length of the binary files', false)}
            <div className="e68-easybin__item">
              <span className="e68-easybin__label">{CAPTIONS.fileSplit}</span>
              {/* A drawn group of digits: role img exposes its label (an aria-label without a role is dropped; Q1-6). */}
              <span
                className="e68-easybin__digits"
                role="img"
                aria-label={`File Split: ${split === 0 ? 1 : split} file(s)`}
              >
                {[0, 1, 2, 3].map((k) => (
                  <span
                    key={k}
                    className={`e68-easybin__digit e68-easybin__byte--file${k}`}
                    hidden={k >= (split === 0 ? 1 : split)}
                  >
                    {k}
                  </span>
                ))}
              </span>
            </div>
          </div>
          <IconButton
            icon="file-save"
            label="Save Binary..."
            size="small"
            className="e68-easybin__groupbutton"
            onClick={() => runCommand(ctx, 'bin.file.saveBinary')}
          />
        </fieldset>
      </div>

      <div className="e68-easybin__strip">
        <span className="e68-easybin__cluster">
          {field('from', `${CAPTIONS.from} ${CAPTIONS.dollar}`, 'From', true)}
          {field('to', `${CAPTIONS.to} ${CAPTIONS.dollar}`, 'To', true)}
        </span>
        <span className="e68-easybin__cluster">
          {field('bytes', `${CAPTIONS.size} ${CAPTIONS.dollar}`, 'Size', false)}
          <Button caption={CAPTIONS.copy} size="small" onClick={() => void copyBytes(ctx)} />
        </span>
        <span className="e68-easybin__cluster">
          {field('fillByte', CAPTIONS.dollar, 'Fill byte', false)}
          <Button caption={CAPTIONS.fill} size="small" onClick={() => void fillBytes(ctx)} />
        </span>
      </div>
    </>
  );
});

/**
 * Hands the text typed into the Address field to the model, which rounds it down to a multiple of 16
 * at once (`Address1Change`, docs/porting/easybin.md 6.1), and says whether the field must be drawn
 * again: when the rounded text is what the field showed before the key (`003000`, then `5` typed
 * into the last place), the field's value does not change, so nothing else would replace the
 * `003005` the field already shows.
 */
export function typeAddress(model: EasybinModel, typed: string): { shown: string; redraw: boolean } {
  model.setField('address', typed);
  const shown = model.getState().fields.address;
  return { shown, redraw: shown !== typed };
}

/** The Address field (6.1, 6.2). */
const AddressLine = memo(function AddressLine({ address }: { address: string }) {
  const ctx = useAppContext();
  const session = easybinOf(ctx);
  const { model } = session;
  const [, redraw] = useReducer((count: number) => count + 1, 0);

  // F1 is not handled here: the dispatcher binds it to `bin.help.help` in EASyBIN mode (tables/keys.ts).
  const onAddressKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    switch (event.key) {
      case 'PageUp':
      case 'PageDown':
      case 'ArrowUp':
      case 'ArrowDown':
        event.preventDefault();
        if (event.key === 'PageUp') model.pageUp();
        else if (event.key === 'PageDown') model.pageDown();
        else if (event.key === 'ArrowUp') model.rowUp();
        else model.rowDown();
        session.focusRows();
        break;
      case 'Enter':
        event.preventDefault();
        model.touch();
        break;
    }
  };

  return (
    <div className="e68-easybin__addressline">
      <MaskedField
        label={`${CAPTIONS.address} ${CAPTIONS.dollar}`}
        aria-label="Address"
        kind="hex"
        width={Math.max(FIELD_WIDTHS.address, address.length)}
        prefix={CAPTIONS.zeroByte}
        value={address}
        onChange={(text) => {
          if (typeAddress(model, text).redraw) redraw();
        }}
        onReject={() => beep(ctx)}
        onKeyDown={onAddressKeyDown}
        className="e68-easybin__field"
      />
    </div>
  );
});

/** The Row and Page buttons (6.2). */
const SideButtons = memo(function SideButtons() {
  const ctx = useAppContext();
  const session = easybinOf(ctx);
  const { model } = session;
  return (
    <div className="e68-easybin__side">
      <span className="e68-easybin__sidelabel">{CAPTIONS.row}</span>
      <IconButton
        icon="chevron-up"
        label="Row up"
        size="small"
        onClick={() => {
          model.rowUp();
          session.focusRows();
        }}
      />
      <IconButton
        icon="chevron-down"
        label="Row down"
        size="small"
        onClick={() => {
          model.rowDown();
          session.focusRows();
        }}
      />
      <span className="e68-easybin__sidelabel">{CAPTIONS.page}</span>
      <IconButton
        icon="chevron-up"
        label="Page up"
        size="small"
        onClick={() => {
          model.pageUp();
          session.focusRows();
        }}
      />
      <IconButton
        icon="chevron-down"
        label="Page down"
        size="small"
        onClick={() => {
          model.pageDown();
          session.focusRows();
        }}
      />
    </div>
  );
});

export function EasybinWorkspace() {
  const ctx = useAppContext();
  const session = easybinOf(ctx);
  const { model } = session;
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const rowsRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState({ width: 8, height: 16 });
  const [focused, setFocused] = useState(false);
  const statusId = useId();

  // The Row and Page buttons and the Address field's keys give the memory area the focus (6.2).
  useEffect(() => {
    session.focusRows = () => rowsRef.current?.focus({ preventScroll: true });
    return () => {
      session.focusRows = () => {};
    };
  }, [session]);

  // Character cell and nRows = client height / row height (5.1).
  useLayoutEffect(() => {
    const rows = rowsRef.current;
    const measure = measureRef.current;
    if (!rows || !measure) return;
    const update = () => {
      const box = measure.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return; // hidden with its mode: keep the old values
      const size = { width: box.width / 10, height: box.height };
      setCell((old) => (old.width === size.width && old.height === size.height ? old : size));
      model.setRows(Math.floor(rows.clientHeight / size.height));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(rows);
    return () => observer.disconnect();
  }, [model]);

  // The rows depend on memory (revision), the address, the number of rows and the colours; a cursor
  // move changes none of them and draws no row (EasybinModel.gotoRC does not bump the revision).
  const { fields, split, row, col } = state;
  const view = useMemo(
    () => model.viewRows(),
    // the inputs of viewRows() in the state; revision counts every change of memory
    [model, state.revision, state.memAddr, state.rows, split, fields.firstAddress, fields.outLength],
  );

  const onRowsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === 'Dead' || event.key === 'Process' || event.key === 'Unidentified') return;
    if (ARROWS.has(event.key)) {
      event.preventDefault();
      model.moveCursor(event.key as Parameters<typeof model.moveCursor>[0]);
      return;
    }
    const byte = keyByte(event);
    if (byte === null) return;
    event.preventDefault();
    if (byte === 'refuse' || model.typeByte(byte) === 'beep') beep(ctx);
  };

  const cursor = row < state.rows ? { row, col } : null;
  const cursorInfo = (() => {
    if (!cursor || !focused) return '';
    const { address, hex } = model.cursorAddress();
    const valid = address >>> 0 < 0x1000000;
    if (!valid) return `Address ${hexText(address, 8)}, outside memory`;
    const value = hexText(model.memory[address] as number, 2);
    return `Address ${hexText(address, 8)}, value ${value}, ${hex ? 'hexadecimal' : 'character'} column`;
  })();

  return (
    <div className="e68-easybin" data-easybin-revision={state.revision}>
      <Controls fields={fields} split={split} />

      <div className="e68-easybin__main">
        <div className="e68-easybin__view">
          <AddressLine address={fields.address} />
          <div className="e68-easybin__header" aria-hidden="true">
            {`${' '.repeat(10)}${COLUMN_HEADER}`}
          </div>
          <div
            ref={rowsRef}
            className="e68-easybin__rows"
            role="group"
            aria-label="Memory"
            aria-roledescription="memory editor"
            aria-describedby={statusId}
            tabIndex={0}
            data-e68-panel-focus=""
            onFocus={() => {
              setFocused(true);
              model.ensureCursor();
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={onRowsKeyDown}
            onWheel={(event) => model.wheel(event.deltaY, event.deltaMode)}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              const rows = rowsRef.current;
              if (!rows) return;
              const box = rows.getBoundingClientRect();
              const padding = parseFloat(getComputedStyle(rows).paddingLeft) || 0;
              const x = event.clientX - box.left - padding;
              const y = event.clientY - box.top;
              event.preventDefault();
              rows.focus({ preventScroll: true });
              model.place(Math.floor(y / cell.height), Math.floor(x / cell.width));
            }}
          >
            <div ref={measureRef} className="e68-easybin__row e68-easybin__measure" aria-hidden="true">
              WWWWWWWWWW
            </div>
            <Rows view={view} />
            {cursor && (
              <div
                className="e68-easybin__cursor"
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
              {cursorInfo}
            </span>
          </div>
        </div>
        <SideButtons />
      </div>
    </div>
  );
}
