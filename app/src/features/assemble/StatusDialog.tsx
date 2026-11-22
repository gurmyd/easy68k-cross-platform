// The dialog `asm.status` (editor-ui §10.4; assembleS.dfm, assembleS.cpp): title
// `Assembler Status - <file name>`, the yellow exclamation icon, `Warnings:` and `Errors:` with the
// counts, and the buttons `&Execute`, `&Load L68`, `&Close`, left to right. No button is the
// default (the form defines none); Execute is enabled only when the assembly allows it, and it is
// disabled again whenever the dialog closes because each assembly opens a new one. Escape and the
// title bar's close button close it like `&Close` (Escape is the port's addition, 1.5).
//
// The buttons only close the dialog with their name; the command that opened it acts on the
// answer (index.ts), after the dialog is gone, as the original closes its box after spawning the
// simulator or opening the listing.
//
// Owner: E5.

import { useId } from 'react';
import type { DialogProps } from '../../contracts';
import { Button, Dialog, Icon } from '../../ui/components';
import type { StatusDialogProps, StatusDialogResult } from './assemble';
import { CLOSE_CAPTION, ERRORS_LABEL, EXECUTE_CAPTION, LOAD_L68_CAPTION, WARNINGS_LABEL } from './texts';
import './assemble.css';

export const STATUS_DIALOG_ID = 'asm.status';

export function StatusDialog({ props, close }: DialogProps<StatusDialogProps, StatusDialogResult>) {
  const countsId = useId();
  return (
    <Dialog
      title={props.title}
      describedBy={countsId}
      className="e68-asm-status"
      footerAlign="center"
      onCancel={() => close('close')}
      footer={
        <>
          <Button caption={EXECUTE_CAPTION} disabled={!props.executeEnabled} onClick={() => close('execute')} />
          <Button caption={LOAD_L68_CAPTION} onClick={() => close('loadL68')} />
          <Button caption={CLOSE_CAPTION} onClick={() => close('close')} />
        </>
      }
    >
      <div className="e68-asm-status__content">
        <span className="e68-asm-status__icon">
          <Icon name="warning" size={32} label="Warning" />
        </span>
        <dl id={countsId} className="e68-asm-status__counts">
          <dt>{WARNINGS_LABEL}</dt>
          <dd data-e68-count="warnings">{props.warnings}</dd>
          <dt>{ERRORS_LABEL}</dt>
          <dd data-e68-count="errors">{props.errors}</dd>
        </dl>
      </div>
    </Dialog>
  );
}
