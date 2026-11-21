// The Auto Trace Options dialog, `sim.autoTrace` (ARCHITECTURE.md 1.4 note 28; sim-ui §14.1;
// `Optionsu.dfm`): the interval of Auto Trace (10 to 1000 ms in steps of 10, changed with the
// up/down control only) and `Disable display update`. OK returns both; Cancel returns null and
// changes nothing (the original keeps a changed check box after Cancel; the port does not).
//
// Owner: U4.

import { useState } from 'react';
import type { DialogProps } from '../../contracts';
import { Button, Checkbox, Dialog, SpinField } from '../../ui/components';
import {
  AUTO_TRACE_LABEL,
  AUTO_TRACE_RANGE,
  AUTO_TRACE_TITLE,
  AUTO_TRACE_UNIT,
  DISABLE_DISPLAY_LABEL,
  clampInterval,
  type AutoTraceResult,
  type AutoTraceValues,
} from './model';
import './sim-options.css';

export function AutoTraceDialog({ props, close }: DialogProps<AutoTraceValues, AutoTraceResult>) {
  const [intervalMs, setIntervalMs] = useState(() => clampInterval(props.intervalMs));
  const [disableDisplay, setDisableDisplay] = useState(props.disableDisplay);
  return (
    <Dialog
      title={AUTO_TRACE_TITLE}
      width={300}
      onCancel={() => close(null)}
      footer={
        <>
          <Button caption="&OK" isDefault onClick={() => close({ intervalMs, disableDisplay })} />
          <Button caption="&Cancel" onClick={() => close(null)} />
        </>
      }
    >
      <div className="e68-autotrace" data-testid="auto-trace-dialog">
        <div className="e68-autotrace__row">
          <SpinField
            label={AUTO_TRACE_LABEL}
            labelPosition="top"
            value={intervalMs}
            min={AUTO_TRACE_RANGE.min}
            max={AUTO_TRACE_RANGE.max}
            step={AUTO_TRACE_RANGE.step}
            onChange={setIntervalMs}
            readOnly
            digits={4}
            data-testid="auto-trace-interval"
          />
          <span className="e68-autotrace__unit">{AUTO_TRACE_UNIT}</span>
        </div>
        <Checkbox label={DISABLE_DISPLAY_LABEL} checked={disableDisplay} onChange={setDisableDisplay} />
      </div>
    </Dialog>
  );
}
