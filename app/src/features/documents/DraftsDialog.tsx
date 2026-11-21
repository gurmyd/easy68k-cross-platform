// The dialog that offers the drafts of a window that is gone (ARCHITECTURE.md 3.9.4): the text
// `Unsaved changes from your last session were found for <names>.` and the buttons `Restore` and
// `Discard`. It must be answered: it has no close button and Escape does nothing.
//
// Owner: E1.

import { useId } from 'react';
import type { DialogProps } from '../../contracts';
import { Button, Dialog } from '../../ui/components';
import type { DraftsDialogProps, DraftsDialogResult } from './drafts';

export function DraftsDialog({ props, close }: DialogProps<DraftsDialogProps, DraftsDialogResult>) {
  const textId = useId();
  return (
    <Dialog
      title={props.title}
      role="alertdialog"
      describedBy={textId}
      footer={
        <>
          <Button caption="&Restore" isDefault onClick={() => close('Restore')} />
          <Button caption="&Discard" onClick={() => close('Discard')} />
        </>
      }
    >
      <p id={textId} style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
        {props.text}
      </p>
    </Dialog>
  );
}
