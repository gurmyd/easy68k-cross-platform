// Edit > Find And Replace... of Editor mode (dialog id `replace`; editor-ui §14.3,
// replaceDialogS.dfm/.cpp). Owner: E6.
//
// Modeless, at the top right of the editor area (below the Find dialog when that is open too).
// `Fi&nd what:`, `Re&place with` (no colon, as in the original), the two check boxes, `&Find Next`
// (the default button), `&Replace`, `Replace &All` and `Cancel`. The three action buttons are
// disabled while "Find what" is empty. The texts and options are the dialog's own (FindModel),
// separate from the Find dialog's.

import { useEffect, useRef, useState } from 'react';
import type { DialogProps as FeatureDialogProps } from '../../contracts';
import { useAppContext, useAppState } from '../../state/context';
import { useStoreValue } from '../../state/store';
import { Button, Checkbox, Dialog, TextField } from '../../ui/components';
import './find.css';
import { dialogAnchor, findModelOf, type FindDialogProps } from './model';

export function ReplaceDialog({ props, close }: FeatureDialogProps<FindDialogProps, void>) {
  const ctx = useAppContext();
  const model = findModelOf(ctx);
  const fields = useStoreValue(model.view, (state) => state.replace);
  const focusSerial = useStoreValue(model.view, (state) => state.replaceFocus);
  const editorMode = useAppState((state) => state.mode === 'editor');
  const input = useRef<HTMLInputElement>(null);
  const [firstSerial] = useState(focusSerial);

  // Find And Replace... while the dialog is open: the focus goes back into its first box.
  useEffect(() => {
    if (focusSerial !== firstSerial) input.current?.focus();
  }, [focusSerial, firstSerial]);

  if (!editorMode) return null;

  const empty = fields.text === '';
  return (
    <Dialog
      title="Replace"
      modal={false}
      onCancel={() => close()}
      initialFocus={input}
      anchor={dialogAnchor(props)}
      className="e68-find-dialog e68-find-dialog--replace"
      footer={
        <>
          <Button
            caption="&Find Next"
            isDefault={!empty}
            disabled={empty}
            onClick={() => void model.findNextFromReplaceDialog()}
          />
          <Button caption="&Replace" disabled={empty} onClick={() => void model.replace(false)} />
          <Button caption="Replace &All" disabled={empty} onClick={() => void model.replace(true)} />
          <Button caption="Cancel" onClick={() => close()} />
        </>
      }
    >
      <div className="e68-find-dialog__body">
        <TextField
          label="Fi&nd what:"
          value={fields.text}
          onChange={(text) => model.setReplace({ text })}
          inputRef={input}
          widthCh={28}
        />
        <TextField
          label="Re&place with"
          value={fields.replacement}
          onChange={(replacement) => model.setReplace({ replacement })}
          widthCh={28}
        />
        <Checkbox
          label="Match &whole word only"
          checked={fields.wholeWord}
          onChange={(wholeWord) => model.setReplace({ wholeWord })}
        />
        <Checkbox
          label="Match &case"
          checked={fields.matchCase}
          onChange={(matchCase) => model.setReplace({ matchCase })}
        />
      </div>
    </Dialog>
  );
}
