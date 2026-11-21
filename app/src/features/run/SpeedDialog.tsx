// The Execution Speed dialog, `sim.speed` (ARCHITECTURE.md 2.7, 4.5.6): EASy68K-like, Maximum, or a
// custom number of instructions per second. OK returns the new setting, Cancel returns null and
// changes nothing.
//
// Owner: SH8.

import { useState } from 'react';
import type { DialogProps } from '../../contracts';
import { Button, Dialog, RadioGroup, TextField } from '../../ui/components';
import './speed-dialog.css';
import {
  MAX_CUSTOM_IPS,
  MIN_CUSTOM_IPS,
  SPEED_CHOICES,
  TIMING_HINT,
  speedFromDialog,
  speedNote,
  type Speed,
  type SpeedMode,
} from './speed';

export function SpeedDialog({ props, close }: DialogProps<Speed, Speed | null>) {
  const [mode, setMode] = useState<SpeedMode>(props.mode);
  const [custom, setCustom] = useState(String(props.instructionsPerSecond));
  const result = speedFromDialog(mode, custom, props);
  const invalid = mode === 'custom' && result === null;
  const range = `${MIN_CUSTOM_IPS.toLocaleString('en-US')} to ${MAX_CUSTOM_IPS.toLocaleString('en-US')}`;

  return (
    <Dialog
      title="Execution Speed"
      width={420}
      onCancel={() => close(null)}
      footer={
        <>
          <Button caption="&OK" isDefault disabled={result === null} onClick={() => result && close(result)} />
          <Button caption="&Cancel" onClick={() => close(null)} />
        </>
      }
    >
      <div className="e68-speed">
        <RadioGroup label="Speed" options={SPEED_CHOICES} value={mode} onChange={setMode} />
        <TextField
          label="&Instructions per second:"
          value={custom}
          onChange={setCustom}
          disabled={mode !== 'custom'}
          invalid={invalid}
          {...(invalid ? { message: `A whole number from ${range}` } : {})}
          inputMode="numeric"
          widthCh={12}
        />
        <p className="e68-speed__note">{speedNote(mode)}</p>
        <p className="e68-speed__note">{TIMING_HINT}</p>
      </div>
    </Dialog>
  );
}
