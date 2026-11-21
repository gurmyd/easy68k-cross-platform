// The Break Points panel (ARCHITECTURE.md 2.6; sim-ui §12.2). Owner: U3.
//
// Three stacked groups, `Registers`, `Memory` and `Expression Builder`, each a grid of 49 numbered
// rows with `Set`, `Clear` and `Clear All`; the builder row `PC/Reg [nn]`, `Memory [nn]`, `AND`,
// `OR`, `(`, `)`, `Backspace`. Double-click or Enter on a row shows the editors in that row; Enter in
// an editor presses `Set`, Escape hides the editors without storing.
//
// All behaviour is in model.ts and core/breakpoints; this component renders and forwards events.

import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import {
  Button,
  DataGrid,
  MaskedField,
  REGISTER_FIELD,
  Select,
  type DataGridColumn,
  type MaskedConfig,
} from '../../ui/components';
import { useAppContext } from '../../state/context';
import {
  ENABLED_CHOICES,
  MAX_ROWS,
  MEMORY_OPS,
  READ_WRITE_CHOICES,
  REGISTER_CHOICES,
  REGISTER_OPS,
  SIZE_CHOICES,
  expressionText,
  type BreakExpressionRow,
  type GridId,
  type MemoryCondition,
  type RegisterCondition,
} from '../../core/breakpoints';
import { breakpointsModelOf, type BreakpointsModel } from './model';
import './breakpoints.css';

/** The 2-digit decimal fields: Count and the builder's row numbers (mask `99;0;0`). */
const TWO_DIGITS: MaskedConfig = { kind: 'decimal', width: 2 };
/** Height of each grid: six rows of the kit's DataGrid. */
const GRID_HEIGHT = 6 * 22;
const ROWS = Array.from({ length: MAX_ROWS }, (_v, index) => index);

const options = (labels: readonly string[]) => labels.map((label, index) => ({ value: String(index), label }));
const REGISTER_OPTIONS = options(REGISTER_CHOICES);
const REGISTER_OP_OPTIONS = options(REGISTER_OPS);
const MEMORY_OP_OPTIONS = options(MEMORY_OPS);
const SIZE_OPTIONS = options(SIZE_CHOICES);
const READ_WRITE_OPTIONS = options(READ_WRITE_CHOICES);
const ENABLED_OPTIONS = options(ENABLED_CHOICES);

const stop = (event: SyntheticEvent) => event.stopPropagation();

/**
 * One in-place editor. Keeps pointer events away from the grid (which would take the focus and
 * select a row) and maps Enter to `Set` and Escape to hiding the editors.
 */
function Editor({ model, grid, children }: { model: BreakpointsModel; grid: GridId; children: ReactNode }) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void model.set(grid);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      model.cancel(grid);
    }
  };
  return (
    <span className="e68-bp__editor" onPointerDown={stop} onDoubleClick={stop} onKeyDown={onKeyDown}>
      {children}
    </span>
  );
}

function GridButtons({ model, grid, label }: { model: BreakpointsModel; grid: GridId; label: string }) {
  const buttons = useSyncExternalStore(model.subscribe, model.getState).buttons[grid];
  return (
    <>
      <Button
        size="small"
        caption="Set"
        aria-label={`Set ${label}`}
        disabled={!buttons.set}
        data-bp-button={`${grid}-set`}
        onClick={() => void model.set(grid)}
      />
      <Button
        size="small"
        caption="Clear"
        aria-label={`Clear ${label}`}
        disabled={!buttons.clear}
        data-bp-button={`${grid}-clear`}
        onClick={() => void model.clear(grid)}
      />
      <Button
        size="small"
        caption="Clear All"
        aria-label={`Clear all ${label}`}
        disabled={!buttons.clearAll}
        data-bp-button={`${grid}-clearAll`}
        onClick={() => void model.clearAll(grid)}
      />
    </>
  );
}

function RegistersGroup({ model }: { model: BreakpointsModel }) {
  const { tables } = useSyncExternalStore(model.subscribe, model.getState);
  const edit = tables.editing.registers;
  const at = (row: number): RegisterCondition | undefined => tables.registers[row];
  const editing = (row: number) => edit !== null && edit.row === row;
  const draft = edit?.draft;
  const columns: DataGridColumn<number>[] = [
    {
      id: 'register',
      header: 'PC/Reg',
      width: '84px',
      mono: true,
      render: (row) =>
        editing(row) && draft ? (
          <Editor model={model} grid="registers">
            <Select
              aria-label={`PC/Reg of row ${row + 1}`}
              monospace
              autoFocus
              options={REGISTER_OPTIONS}
              value={String(draft.register)}
              onChange={(value) => model.updateRegister({ register: Number(value) })}
            />
          </Editor>
        ) : (
          (REGISTER_CHOICES[at(row)?.register ?? -1] ?? '')
        ),
    },
    {
      id: 'op',
      header: 'Op',
      width: '76px',
      mono: true,
      render: (row) =>
        editing(row) && draft ? (
          <Editor model={model} grid="registers">
            <Select
              aria-label={`Op of row ${row + 1}`}
              monospace
              options={REGISTER_OP_OPTIONS}
              value={String(draft.op)}
              onChange={(value) => model.updateRegister({ op: Number(value) })}
            />
          </Editor>
        ) : (
          (REGISTER_OPS[at(row)?.op ?? -1] ?? '')
        ),
    },
    {
      id: 'value',
      header: 'Value',
      width: '108px',
      mono: true,
      render: (row) =>
        editing(row) && draft ? (
          <Editor model={model} grid="registers">
            <MaskedField
              {...REGISTER_FIELD}
              aria-label={`Value of row ${row + 1}`}
              autoSelect
              value={draft.value}
              onChange={(value) => model.updateRegister({ value })}
            />
          </Editor>
        ) : (
          (at(row)?.value ?? '')
        ),
    },
    {
      id: 'size',
      header: 'Size',
      width: '68px',
      mono: true,
      render: (row) =>
        editing(row) && draft ? (
          <Editor model={model} grid="registers">
            <Select
              aria-label={`Size of row ${row + 1}`}
              monospace
              options={SIZE_OPTIONS}
              value={String(draft.size)}
              onChange={(value) => model.updateRegister({ size: Number(value) })}
            />
          </Editor>
        ) : (
          (SIZE_CHOICES[at(row)?.size ?? -1] ?? '')
        ),
    },
  ];
  return (
    <ConditionGrid
      model={model}
      grid="registers"
      label="Register conditions"
      columns={columns}
      legend="Registers"
      focusTarget
    />
  );
}

function MemoryGroup({ model }: { model: BreakpointsModel }) {
  const { tables } = useSyncExternalStore(model.subscribe, model.getState);
  const edit = tables.editing.memory;
  const at = (row: number): MemoryCondition | undefined => tables.memory[row];
  const editing = (row: number) => edit !== null && edit.row === row;
  const draft = edit?.draft;
  const columns: DataGridColumn<number>[] = [
    {
      id: 'address',
      header: 'Address',
      width: '108px',
      mono: true,
      render: (row) =>
        editing(row) && draft ? (
          <Editor model={model} grid="memory">
            <MaskedField
              {...REGISTER_FIELD}
              aria-label={`Address of row ${row + 1}`}
              autoSelect
              autoFocus
              value={draft.address}
              onChange={(address) => model.updateMemory({ address })}
            />
          </Editor>
        ) : (
          (at(row)?.address ?? '')
        ),
    },
    {
      id: 'op',
      header: 'Op',
      width: '76px',
      mono: true,
      render: (row) =>
        editing(row) && draft ? (
          <Editor model={model} grid="memory">
            <Select
              aria-label={`Op of row ${row + 1}`}
              monospace
              options={MEMORY_OP_OPTIONS}
              value={String(draft.op)}
              onChange={(value) => model.updateMemory({ op: Number(value) })}
            />
          </Editor>
        ) : (
          (MEMORY_OPS[at(row)?.op ?? -1] ?? '')
        ),
    },
    {
      id: 'value',
      header: 'Value',
      width: '108px',
      mono: true,
      render: (row) =>
        editing(row) && draft ? (
          <Editor model={model} grid="memory">
            <MaskedField
              {...REGISTER_FIELD}
              aria-label={`Value of row ${row + 1}`}
              autoSelect
              value={draft.value}
              onChange={(value) => model.updateMemory({ value })}
            />
          </Editor>
        ) : (
          (at(row)?.value ?? '')
        ),
    },
    {
      id: 'size',
      header: 'Size',
      width: '68px',
      mono: true,
      render: (row) =>
        editing(row) && draft ? (
          <Editor model={model} grid="memory">
            <Select
              aria-label={`Size of row ${row + 1}`}
              monospace
              options={SIZE_OPTIONS}
              value={String(draft.size)}
              onChange={(value) => model.updateMemory({ size: Number(value) })}
            />
          </Editor>
        ) : (
          (SIZE_CHOICES[at(row)?.size ?? -1] ?? '')
        ),
    },
    {
      id: 'readWrite',
      header: 'R/W',
      width: '92px',
      mono: true,
      render: (row) =>
        editing(row) && draft ? (
          <Editor model={model} grid="memory">
            <Select
              aria-label={`R/W of row ${row + 1}`}
              monospace
              options={READ_WRITE_OPTIONS}
              value={String(draft.readWrite)}
              onChange={(value) => model.updateMemory({ readWrite: Number(value) })}
            />
          </Editor>
        ) : (
          (READ_WRITE_CHOICES[at(row)?.readWrite ?? -1] ?? '')
        ),
    },
  ];
  return <ConditionGrid model={model} grid="memory" label="Memory conditions" columns={columns} legend="Memory" />;
}

/** A group with its grid and its three buttons. */
function ConditionGrid({
  model,
  grid,
  label,
  legend,
  columns,
  children,
  focusTarget = false,
}: {
  model: BreakpointsModel;
  grid: GridId;
  label: string;
  legend: string;
  columns: DataGridColumn<number>[];
  children?: ReactNode;
  focusTarget?: boolean;
}) {
  const { tables } = useSyncExternalStore(model.subscribe, model.getState);
  const edit = tables.editing[grid];
  const holder = useRef<HTMLDivElement>(null);
  // The grid of the Registers group is where View > Break Points puts the focus (2.10).
  useEffect(() => {
    if (!focusTarget) return;
    holder.current?.querySelector('[role="grid"]')?.setAttribute('data-e68-panel-focus', '');
  }, [focusTarget]);
  return (
    <fieldset className={`e68-bp__group e68-bp__group--${grid}`} data-bp-group={grid}>
      <legend className="e68-bp__legend">{legend}</legend>
      <div ref={holder} className="e68-bp__grid">
        <DataGrid
          label={label}
          rowNumbers
          columns={columns}
          rows={ROWS}
          rowKey={(row) => String(row)}
          selectedRow={tables.selected[grid]}
          onSelectRow={(row) => model.select(grid, row)}
          onActivate={(row) => model.edit(grid, row)}
          editing={edit ? { row: edit.row, column: -1 } : null}
          height={GRID_HEIGHT}
        />
      </div>
      <div className="e68-bp__buttons">
        <GridButtons model={model} grid={grid} label={label.toLowerCase()} />
        {children}
      </div>
    </fieldset>
  );
}

function ExpressionGroup({ model }: { model: BreakpointsModel }) {
  const { tables, buttons } = useSyncExternalStore(model.subscribe, model.getState);
  const edit = tables.editing.expressions;
  const at = (row: number): BreakExpressionRow | undefined => tables.expressions[row];
  const editing = (row: number) => edit !== null && edit.row === row;
  const draft = edit?.draft;
  const columns: DataGridColumn<number>[] = [
    {
      id: 'enabled',
      header: 'Enabled',
      width: '84px',
      mono: true,
      render: (row) => {
        if (editing(row) && draft) {
          return (
            <Editor model={model} grid="expressions">
              <Select
                aria-label={`Enabled of row ${row + 1}`}
                monospace
                autoFocus
                options={ENABLED_OPTIONS}
                value={draft.enabled ? '0' : '1'}
                onChange={(value) => model.updateExpression({ enabled: value === '0' })}
              />
            </Editor>
          );
        }
        const expression = at(row);
        return expression ? (expression.enabled ? 'ON' : 'OFF') : '';
      },
    },
    {
      id: 'expression',
      header: 'Expression',
      width: 'minmax(280px, 1fr)',
      mono: true,
      render: (row) =>
        editing(row) && draft ? (
          <span className="e68-bp__draft" data-bp-draft="" aria-live="polite">
            {expressionText(draft.tokens)}
          </span>
        ) : (
          <span className="e68-bp__text">{at(row) ? expressionText((at(row) as BreakExpressionRow).tokens) : ''}</span>
        ),
    },
    {
      id: 'count',
      header: 'Count',
      width: '72px',
      mono: true,
      render: (row) =>
        editing(row) && draft ? (
          <Editor model={model} grid="expressions">
            <MaskedField
              {...TWO_DIGITS}
              aria-label={`Count of row ${row + 1}`}
              autoSelect
              value={draft.count}
              onChange={(count) => model.updateExpression({ count })}
            />
          </Editor>
        ) : (
          (at(row)?.count ?? '')
        ),
    },
  ];
  const b = buttons.builder;
  return (
    <ConditionGrid
      model={model}
      grid="expressions"
      label="Break expressions"
      legend="Expression Builder"
      columns={columns}
    >
      <span className="e68-bp__builder" role="group" aria-label="Build the expression">
        <Button
          size="small"
          caption="PC/Reg"
          disabled={!b.operand}
          data-bp-button="reg"
          onClick={() => void model.appendCondition('reg')}
        />
        <MaskedField
          {...TWO_DIGITS}
          aria-label="PC/Reg condition number"
          data-bp-field="reg"
          autoSelect
          value={tables.builder.register}
          onChange={(text) => model.setBuilderField('register', text)}
        />
        <Button
          size="small"
          caption="Memory"
          disabled={!b.operand}
          data-bp-button="mem"
          onClick={() => void model.appendCondition('mem')}
        />
        <MaskedField
          {...TWO_DIGITS}
          aria-label="Memory condition number"
          data-bp-field="mem"
          autoSelect
          value={tables.builder.memory}
          onChange={(text) => model.setBuilderField('memory', text)}
        />
        <Button
          size="small"
          caption="AND"
          disabled={!b.operator}
          data-bp-button="and"
          onClick={() => model.appendSymbol('AND')}
        />
        <Button
          size="small"
          caption="OR"
          disabled={!b.operator}
          data-bp-button="or"
          onClick={() => model.appendSymbol('OR')}
        />
        <Button
          size="small"
          caption="("
          disabled={!b.lparen}
          data-bp-button="lparen"
          onClick={() => model.appendSymbol('(')}
        />
        <Button
          size="small"
          caption=")"
          disabled={!b.rparen}
          data-bp-button="rparen"
          onClick={() => model.appendSymbol(')')}
        />
        <Button
          size="small"
          caption="Backspace"
          disabled={!b.backspace}
          data-bp-button="backspace"
          onClick={() => model.backspace()}
        />
      </span>
    </ConditionGrid>
  );
}

export function BreakpointsPanel() {
  const ctx = useAppContext();
  const model = breakpointsModelOf(ctx);
  return (
    <div className="e68-bp">
      <div className="e68-bp__conditions">
        <RegistersGroup model={model} />
        <MemoryGroup model={model} />
      </div>
      <ExpressionGroup model={model} />
    </div>
  );
}
