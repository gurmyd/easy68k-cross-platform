// The Serial Ports dialog (ARCHITECTURE.md 3.3.4, 9.6 DV4): which device of this computer each
// port name of TRAP #15 task 40 (`COM1` ...) opens. OK returns the new AppSettings.serialPortMap,
// Cancel returns null and changes nothing. The original had no such dialog: Windows names its
// serial ports COM1 ... itself, a Mac names them /dev/cu.<something>.
//
// Owner: DV4.

import { useState } from 'react';
import type { DialogProps } from '../../contracts';
import { Button, Dialog, Select, TextField } from '../../ui/components';
import './desktop-devices.css';
import {
  detectedLabel,
  mapFromRows,
  nextPortName,
  rowProblemDetails,
  rowsFromMap,
  type DetectedPort,
  type PortRow,
} from './model';

export interface SerialPortsDialogProps {
  map: Readonly<Record<string, string>>;
  /** Devices the main process found when the dialog was opened. */
  detected: readonly DetectedPort[];
}

const INTRO =
  'A program opens a serial port by name with TRAP #15 task 40 (for example COM1). ' +
  'Give each name the device of this computer it stands for. A name that is not listed cannot be opened.';

export function SerialPortsDialog({
  props,
  close,
}: DialogProps<SerialPortsDialogProps, Record<string, string> | null>) {
  const [rows, setRows] = useState<PortRow[]>(() => rowsFromMap(props.map));
  const problems = rowProblemDetails(rows);
  const result = mapFromRows(rows);
  const detectedOptions = [
    { value: '', label: 'Detected devices...' },
    ...props.detected.map((port) => ({ value: port.path, label: detectedLabel(port) })),
  ];

  const change = (index: number, patch: Partial<PortRow>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <Dialog
      title="Serial Ports"
      width={720}
      onCancel={() => close(null)}
      footer={
        <>
          <Button caption="&OK" isDefault disabled={result === null} onClick={() => result && close(result)} />
          <Button caption="&Cancel" onClick={() => close(null)} />
        </>
      }
    >
      <div className="e68-serial-ports">
        <p className="e68-serial-ports__note">{INTRO}</p>
        {rows.length === 0 ? (
          <p className="e68-serial-ports__note" data-e68-serial-empty="">
            No serial ports are set up.
          </p>
        ) : (
          <ul className="e68-serial-ports__rows" aria-label="Serial ports">
            {rows.map((row, index) => {
              const problem = problems[index] ?? null;
              return (
                <li key={index} className="e68-serial-ports__row" data-e68-serial-row={index}>
                  <TextField
                    label="Name:"
                    value={row.name}
                    onChange={(name) => change(index, { name })}
                    widthCh={8}
                    invalid={problem?.field === 'name'}
                    {...(problem?.field === 'name' ? { message: problem.text } : {})}
                    spellCheck={false}
                  />
                  <TextField
                    label="Device:"
                    value={row.device}
                    onChange={(device) => change(index, { device })}
                    monospace
                    invalid={problem?.field === 'device'}
                    {...(problem?.field === 'device' ? { message: problem.text } : {})}
                    spellCheck={false}
                  />
                  {props.detected.length > 0 && (
                    <Select
                      aria-label={`Detected device for ${row.name || 'this port'}`}
                      options={detectedOptions}
                      value=""
                      onChange={(device) => device && change(index, { device })}
                      widthCh={18}
                    />
                  )}
                  <Button
                    caption="Remove"
                    aria-label={`Remove ${row.name || 'this port'}`}
                    onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <div className="e68-serial-ports__actions">
          <Button
            caption="&Add Port"
            disabled={nextPortName(rows) === ''}
            onClick={() => setRows((current) => [...current, { name: nextPortName(current), device: '' }])}
          />
          {props.detected.length === 0 && (
            <span className="e68-serial-ports__note">No serial devices were found on this computer.</span>
          )}
        </div>
      </div>
    </Dialog>
  );
}
