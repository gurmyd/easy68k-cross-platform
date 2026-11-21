// The Stack panel (ARCHITECTURE.md 2.6; sim-ui §11). Owner: U2.
//
// Rows of "%08X: " and four bytes with the selected pointer on the middle row; on the right the
// spin buttons and the `View` list (A0..A6, US, SS). Aqua and yellow byte backgrounds mark the
// selected register's address and the active stack pointer; red text marks bytes in the enabled
// Invalid range of the Hardware panel. There is no editing.
//
// All behaviour is in model.ts and rules.ts; this component measures, renders and forwards events.

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type KeyboardEvent } from 'react';
import { IconButton, Select } from '../../ui/components';
import { useAppContext } from '../../state/context';
import { stackModelOf } from './model';
import { STACK_CHOICES, type StackRow } from './rules';
import './stack.css';

const OPTIONS = STACK_CHOICES.map((label, index) => ({ value: String(index), label }));

function Row({ row }: { row: StackRow }) {
  return (
    <div className="e68-stack__row">
      <span className="e68-stack__addr">{row.addressText}</span>
      {row.bytes.map((byte) => (
        <span
          key={byte.address}
          className="e68-stack__byte"
          data-mark={byte.mark ?? undefined}
          data-invalid={byte.invalid ? 'true' : undefined}
        >
          {byte.text}
        </span>
      ))}
    </div>
  );
}

export function StackPanel() {
  const ctx = useAppContext();
  const model = stackModelOf(ctx);
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const rowsRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  // nRows = client height / row height.
  useLayoutEffect(() => {
    const rows = rowsRef.current;
    const measure = measureRef.current;
    if (!rows || !measure) return;
    const update = () => {
      const height = measure.getBoundingClientRect().height;
      if (height === 0) return; // hidden behind another tab
      model.setRows(Math.floor(rows.clientHeight / height));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(rows);
    return () => observer.disconnect();
  }, [model]);

  // FormShow: showing the panel re-centres it on the selected register.
  useEffect(() => {
    model.shown();
  }, [model]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      model.scrollUp();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      model.scrollDown();
    }
  };

  return (
    <div className="e68-stack">
      <div
        ref={rowsRef}
        className="e68-stack__rows"
        role="group"
        aria-label="Stack contents"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onWheel={(event) => model.wheel(event.deltaY, event.deltaMode)}
      >
        <div ref={measureRef} className="e68-stack__row e68-stack__measure" aria-hidden="true">
          W
        </div>
        {state.view.map((row, index) => (
          <Row key={index} row={row} />
        ))}
      </div>
      <div className="e68-stack__side">
        <IconButton icon="chevron-up" label="Lower addresses" size="small" onClick={() => model.scrollUp()} />
        <IconButton icon="chevron-down" label="Higher addresses" size="small" onClick={() => model.scrollDown()} />
        <Select
          label="View"
          labelPosition="top"
          monospace
          widthCh={4}
          options={OPTIONS}
          value={String(state.choice)}
          onChange={(value) => model.setChoice(Number(value))}
          data-e68-panel-focus=""
        />
      </div>
    </div>
  );
}
