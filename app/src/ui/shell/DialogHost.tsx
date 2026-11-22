// Draws the open dialogs and the toasts (ARCHITECTURE.md 2.7, 3.12.4). Owner: W3.
//
// The dialog service (state/dialogs.ts) keeps the open dialogs in AppState.dialogs.stack. For each
// one this host renders the component that a feature registered under the dialog's id, with the
// dialog's `props` and a `close(result)` that resolves the opener's promise. A message box (id
// `message`) is the component kit's MessageBox; its result is the caption of the pressed button.
// MessageBoxRequest.defaultButton (a caption) becomes the kit's defaultButton index; absent, the
// first button is the default, as before.
// The components draw themselves with the kit's Dialog, modal or modeless as they were opened.

import type { MessageBoxRequest } from '../../contracts';
import { useAppState, useApplication } from '../../state/context';
import { MESSAGE_DIALOG_ID } from '../../state/dialogs';
import { useStoreValue } from '../../state/store';
import { MessageBox, messageBoxDefaultIndex, ToastStack } from '../components';

export function DialogHost() {
  const { dialogs, dialogComponents } = useApplication();
  const stack = useAppState((state) => state.dialogs.stack);
  return (
    <>
      {stack.map((dialog) => {
        const close = (result: unknown) => dialogs.close(dialog.key, result);
        if (dialog.id === MESSAGE_DIALOG_ID) {
          const request = dialog.props as MessageBoxRequest;
          return (
            <MessageBox
              key={dialog.key}
              title={request.title}
              text={request.text}
              icon={request.icon}
              buttons={request.buttons}
              defaultButton={messageBoxDefaultIndex(request.buttons, request.defaultButton)}
              onResult={close}
            />
          );
        }
        const Dialog = dialogComponents.get(dialog.id);
        return Dialog ? <Dialog key={dialog.key} props={dialog.props} close={close} /> : null;
      })}
    </>
  );
}

export function ToastHost() {
  const { dialogs } = useApplication();
  const toasts = useStoreValue(dialogs.toasts, (list) => list);
  return <ToastStack toasts={toasts} onDismiss={(id) => dialogs.dismissToast(Number(id))} />;
}
