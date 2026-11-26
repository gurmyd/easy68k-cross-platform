// The Registers panel: the group box `Registers` of the original main window (sim-ui §2, §4, §5;
// ARCHITECTURE.md 2.3, 3.11.3).
//
//   D0=xxxxxxxx  D4=xxxxxxxx  A0=xxxxxxxx  A4=xxxxxxxx      T S  INT   XNZVC       Cycles
//   D1=xxxxxxxx  D5=xxxxxxxx  A1=xxxxxxxx  A5=xxxxxxxx  SR=bbbbbbbbbbbbbbbb   [   cycles]
//   D2=xxxxxxxx  D6=xxxxxxxx  A2=xxxxxxxx  A6=xxxxxxxx  US=xxxxxxxx           [Clear Cycles]
//   D3=xxxxxxxx  D7=xxxxxxxx  A3=xxxxxxxx  A7=xxxxxxxx  SS=xxxxxxxx  PC=xxxxxxxx
//
// The fields have no rules of their own (3.11.3): the kit's MaskedField gives the original's
// TMaskEdit behaviour (REGISTER_FIELD, SR_FIELD), every change is forwarded with editBox and all
// twenty texts are re-read (SimMainModel.editRegister). The DOM order is the original's tab
// order: D0-D7, A0-A7, SR, PC, SS, Clear Cycles, US; CSS grid places the fields.

import { useId, type CSSProperties } from 'react';
import { Box } from '../../contracts';
import { useAppContext, useAppState } from '../../state/context';
import { useStoreValue } from '../../state/store';
import { Button, MaskedField, REGISTER_FIELD, SR_FIELD } from '../../ui/components';
import { beep } from './beep';
import { ADDRESS_BOXES, simMainOf } from './model';
import { revealInArea } from './reveal';

/** Caption of the label above the SR field; its 16 characters line up with the 16 bits (sim-ui §4.1). */
export const SR_FLAGS_CAPTION = 'T S  INT   XNZVC';

/** Label texts by Box (sim-ui §4.1: the SS field is labelled `SS=`, the US field `US=`). */
export const BOX_LABELS: readonly string[] = [
  'D0=',
  'D1=',
  'D2=',
  'D3=',
  'D4=',
  'D5=',
  'D6=',
  'D7=',
  'A0=',
  'A1=',
  'A2=',
  'A3=',
  'A4=',
  'A5=',
  'A6=',
  'A7=',
  'US=',
  'SS=',
  'PC=',
  'SR=',
];

/** The register grid on the left: four columns of four, filled column by column. */
const GRID_BOXES: readonly Box[] = [
  Box.D0,
  Box.D1,
  Box.D2,
  Box.D3,
  Box.D4,
  Box.D5,
  Box.D6,
  Box.D7,
  Box.A0,
  Box.A1,
  Box.A2,
  Box.A3,
  Box.A4,
  Box.A5,
  Box.A6,
  Box.A7,
];

interface FieldProps {
  box: Box;
  text: string;
  changed: boolean;
  style?: CSSProperties;
}

function RegisterField({ box, text, changed, style }: FieldProps) {
  const ctx = useAppContext();
  const model = simMainOf(ctx);
  const id = useId();
  const isSR = box === Box.SR;
  const onDoubleClick = () => {
    if (box === Box.PC) model.gotoPC();
    else if (ADDRESS_BOXES.has(box)) model.copyToMemory(box);
  };
  return (
    <span className="e68-regs__cell" style={style}>
      <label className="e68-regs__label" htmlFor={id}>
        {BOX_LABELS[box]}
      </label>
      {isSR ? (
        <MaskedField
          id={id}
          {...SR_FIELD}
          value={text}
          onChange={(next) => model.editRegister(box, next)}
          onReject={() => beep(ctx)}
          data-changed={changed ? 'true' : undefined}
          data-box={box}
        />
      ) : (
        <MaskedField
          id={id}
          {...REGISTER_FIELD}
          autoSelect
          value={text}
          onChange={(next) => model.editRegister(box, next)}
          onReject={() => beep(ctx)}
          onDoubleClick={onDoubleClick}
          data-changed={changed ? 'true' : undefined}
          data-box={box}
        />
      )}
    </span>
  );
}

export function RegistersPanel() {
  const ctx = useAppContext();
  const model = simMainOf(ctx);
  const view = useStoreValue(model.view, (state) => state);
  const colour = useAppState((state) => state.settings.sim.highlightChangedRegisters);
  const field = (box: Box, style?: CSSProperties) => (
    <RegisterField
      key={box}
      box={box}
      text={view.boxes[box] ?? ''}
      changed={colour && (view.changed[box] ?? false)}
      {...(style ? { style } : {})}
    />
  );
  // The panel's own scroll area (version 1.1): a region narrower or shorter than the fields scrolls,
  // and a field that gets the focus is brought into view by the area's own offsets (reveal.ts).
  return (
    <div
      className="e68-regs-scroll"
      data-regs-scroll=""
      onFocus={(event) => revealInArea(event.currentTarget, event.target)}
    >
      <div className="e68-regs">
        <div className="e68-regs__grid">{GRID_BOXES.map((box) => field(box))}</div>
        <div className="e68-regs__side">
          <span className="e68-regs__flags" aria-hidden="true" style={{ gridArea: 'flags' }}>
            <span className="e68-regs__label e68-regs__spacer">{'SR='}</span>
            <span className="e68-regs__flagtext">{SR_FLAGS_CAPTION}</span>
          </span>
          {field(Box.SR, { gridArea: 'sr' })}
          {field(Box.PC, { gridArea: 'pc' })}
          {field(Box.SS, { gridArea: 'ss' })}
          <span className="e68-regs__cycles-label" style={{ gridArea: 'cyclabel' }}>
            {'Cycles'}
          </span>
          <span className="e68-regs__cycles" style={{ gridArea: 'cycles' }} data-cycles="">
            {view.cycles}
          </span>
          <span className="e68-regs__clear" style={{ gridArea: 'clear' }}>
            <Button caption="Clear Cycles" size="small" onClick={() => void ctx.commands.run('sim.cycles.clear')} />
          </span>
          {field(Box.US, { gridArea: 'us' })}
        </div>
      </div>
    </div>
  );
}
