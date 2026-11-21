// The `Log File Options` question, dialog `sim.logFileExists` (ARCHITECTURE.md 2.7; sim-ui §13.3
// step 1; `LogfileDialogu.dfm`): a log file exists already. Replace, Append or Cancel. The
// simulator session opens it (features/run/session.ts) as a modal dialog, which holds the program
// while it is open (4.4.5).
//
// Owner: U4.

import type { DialogProps, LogFileExistsProps, LogFileExistsResult } from '../../contracts';
import { Button, Dialog } from '../../ui/components';
import { LOG_FILE_OPTIONS_TITLE, fileExistsMessage } from './model';
import './log.css';

export function LogFileExistsDialog({ props, close }: DialogProps<LogFileExistsProps, LogFileExistsResult>) {
  return (
    <Dialog
      title={LOG_FILE_OPTIONS_TITLE}
      width={360}
      onCancel={() => close('Cancel')}
      footer={
        <>
          <Button caption="Replace" isDefault onClick={() => close('Replace')} />
          <Button caption="Append" onClick={() => close('Append')} />
          <Button caption="Cancel" onClick={() => close('Cancel')} />
        </>
      }
    >
      <div className="e68-logq">
        <p className="e68-logq__message">{fileExistsMessage(props.kind)}</p>
        {props.fileName !== '' && <p className="e68-logq__name">{props.fileName}</p>}
      </div>
    </Dialog>
  );
}
