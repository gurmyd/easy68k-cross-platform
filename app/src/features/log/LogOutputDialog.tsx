// The Log Output dialog, `sim.logOutput` (ARCHITECTURE.md 2.7; sim-ui §13.2; `logU.dfm`): what to
// log and where. Modeless, as the original's form: the program keeps running while it is open.
//
// OK returns the six values (they select what is logged; logging itself starts with Log Start);
// Cancel returns null, and the values the dialog was opened with stay. Log Start closes the dialog,
// as the original's prepareLogFile does (`Log->Close()`).
//
// Owner: U4.

import { useEffect, useState } from 'react';
import type { DialogProps, LogDialogValues } from '../../contracts';
import { ENTRY_PAGES } from '../../core/help/context';
import { useAppContext } from '../../state/context';
import { Button, Dialog, IconButton, MaskedField, RadioGroup, TextField } from '../../ui/components';
import {
  EXEC_NAME_LABEL,
  EXEC_SAVE_NAME,
  EXEC_TYPE_ITEMS,
  EXEC_TYPE_TITLE,
  INVALID_ADDRESS_TEXT,
  INVALID_ADDRESS_TITLE,
  LOG_OUTPUT_TITLE,
  MEM_BYTES_FIELD,
  MEM_BYTES_LABEL,
  MEM_FROM_FIELD,
  MEM_FROM_LABEL,
  MEM_RANGE_TITLE,
  OUTPUT_NAME_LABEL,
  OUTPUT_SAVE_NAME,
  OUTPUT_TYPE_ITEMS,
  OUTPUT_TYPE_TITLE,
  SAVE_DIALOG_TITLE,
  SAVE_FILTER,
  draftOf,
  folderOf,
  isInvalidLogAddress,
  memRangeVisible,
  valuesOf,
  type LogDialogDraft,
} from './model';
import './log.css';

export interface LogOutputProps {
  /** The values when the dialog is shown (FormShow): Cancel keeps them. */
  values: LogDialogValues;
}
export type LogOutputResult = LogDialogValues | null;

const EXEC_OPTIONS = EXEC_TYPE_ITEMS.map((label, index) => ({ value: String(index), label }));
const OUTPUT_OPTIONS = OUTPUT_TYPE_ITEMS.map((label, index) => ({ value: String(index), label }));

export function LogOutputDialog({ props, close }: DialogProps<LogOutputProps, LogOutputResult>) {
  const ctx = useAppContext();
  const [draft, setDraft] = useState<LogDialogDraft>(() => draftOf(props.values));
  const change = (patch: Partial<LogDialogDraft>) => setDraft((current) => ({ ...current, ...patch }));

  // Log Start closes the dialog (logU.cpp:193), without OK.
  useEffect(() => {
    const log = ctx.sim.log;
    return log.subscribe(() => {
      if (log.state.logging) close(null);
    });
  }, [ctx, close]);

  /** The folder button: a Save dialog without an overwrite question (TSaveDialog defaults). */
  const browse = async (which: 'exec' | 'output') => {
    const current = which === 'exec' ? draft.execFileName : draft.outputFileName;
    const folder = folderOf(current);
    const name = which === 'exec' ? EXEC_SAVE_NAME : OUTPUT_SAVE_NAME;
    const chosen = await ctx.fileDialogs.save({
      title: SAVE_DIALOG_TITLE,
      filters: [SAVE_FILTER],
      defaultExt: '',
      ...(folder ? { suggested: `${folder}/${name}` } : {}),
      overwritePrompt: null,
    });
    if (chosen !== null) change(which === 'exec' ? { execFileName: chosen } : { outputFileName: chosen });
  };

  const leaveFrom = () => {
    if (isInvalidLogAddress(draft.memFromText)) {
      void ctx.dialogs.messageBox({
        title: INVALID_ADDRESS_TITLE,
        text: INVALID_ADDRESS_TEXT,
        icon: 'information',
        buttons: ['OK'],
      });
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // F1 opens the page of the original's `SIM_OPTIONS` context (sim-ui §13.2).
    if (event.key === 'F1' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      void ctx.commands.run('sim.help.help', ENTRY_PAGES.simulatorOptions);
    }
  };

  return (
    <Dialog
      title={LOG_OUTPUT_TITLE}
      modal={false}
      width={460}
      onCancel={() => close(null)}
      onKeyDown={onKeyDown}
      footer={
        <>
          <Button caption="&OK" isDefault onClick={() => close(valuesOf(draft))} />
          <Button caption="&Cancel" onClick={() => close(null)} />
        </>
      }
    >
      <div className="e68-logdlg" data-testid="log-output-dialog">
        <div className="e68-logdlg__file">
          <TextField
            label={EXEC_NAME_LABEL}
            labelPosition="top"
            value={draft.execFileName}
            onChange={(execFileName) => change({ execFileName })}
            spellCheck={false}
            data-testid="log-exec-name"
          />
          <IconButton icon="folder" label="Choose the execution log file" onClick={() => void browse('exec')} />
        </div>
        <div className="e68-logdlg__row">
          <RadioGroup
            label={EXEC_TYPE_TITLE}
            options={EXEC_OPTIONS}
            value={String(draft.execType)}
            onChange={(value) => change({ execType: Number(value) as LogDialogDraft['execType'] })}
            name="e68-log-exec-type"
          />
          {memRangeVisible(draft.execType) && (
            <fieldset className="e68-logdlg__mem" data-testid="log-mem-range">
              <legend>{MEM_RANGE_TITLE}</legend>
              <MaskedField
                {...MEM_FROM_FIELD}
                label={MEM_FROM_LABEL}
                value={draft.memFromText}
                onChange={(memFromText) => change({ memFromText })}
                onBlur={leaveFrom}
                data-testid="log-mem-from"
              />
              <MaskedField
                {...MEM_BYTES_FIELD}
                label={MEM_BYTES_LABEL}
                value={draft.memBytesText}
                onChange={(memBytesText) => change({ memBytesText })}
                data-testid="log-mem-bytes"
              />
            </fieldset>
          )}
        </div>
        <div className="e68-logdlg__file">
          <TextField
            label={OUTPUT_NAME_LABEL}
            labelPosition="top"
            value={draft.outputFileName}
            onChange={(outputFileName) => change({ outputFileName })}
            spellCheck={false}
            data-testid="log-output-name"
          />
          <IconButton icon="folder" label="Choose the output log file" onClick={() => void browse('output')} />
        </div>
        <RadioGroup
          label={OUTPUT_TYPE_TITLE}
          options={OUTPUT_OPTIONS}
          value={String(draft.outputType)}
          onChange={(value) => change({ outputType: Number(value) as LogDialogDraft['outputType'] })}
          name="e68-log-output-type"
        />
      </div>
    </Dialog>
  );
}
