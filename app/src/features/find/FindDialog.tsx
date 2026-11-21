// Edit > Find... of Editor mode (dialog id `find`; editor-ui §14.1, findDialogS.dfm/.cpp). Owner: E6.
//
// Modeless, at the top right of the editor area (1.3.3; below the Replace dialog when that is
// open). The label `Fi&nd what:`, the two check boxes, the default button `Find  (F3)` (two blanks; disabled while the text box is empty) and
// `Cancel`. Opened with text in the box, the button has the focus, so Enter searches at once.
// Find... again while it is open brings the focus back into it. The text and the options live in
// the window's FindModel, so that F3 uses them while the dialog is closed.

import { useEffect, useRef, useState } from 'react';
import type { DialogProps as FeatureDialogProps } from '../../contracts';
import { useAppContext, useAppState } from '../../state/context';
import { useStoreValue } from '../../state/store';
import { Button, Checkbox, Dialog, TextField } from '../../ui/components';
import './find.css';
import { dialogAnchor, findModelOf, type FindDialogProps } from './model';

export const FIND_BUTTON_CAPTION = 'Find  (F3)';

export function FindDialog({ props, close }: FeatureDialogProps<FindDialogProps, void>) {
  const ctx = useAppContext();
  const model = findModelOf(ctx);
  const fields = useStoreValue(model.view, (state) => state.find);
  const focusSerial = useStoreValue(model.view, (state) => state.findFocus);
  const editorMode = useAppState((state) => state.mode === 'editor');
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [firstSerial] = useState(focusSerial);
  const [openedWithText] = useState(fields.text !== '');

  // Find... while the dialog is open: the focus goes to the button, or to the box while it is empty.
  useEffect(() => {
    if (focusSerial === firstSerial) return;
    if (model.view.getState().find.text !== '') button.current?.focus();
    else input.current?.focus();
  }, [focusSerial, firstSerial, model]);

  // The editor's dialog belongs to Editor mode; it stays open (with its text) while another mode is shown.
  if (!editorMode) return null;

  const empty = fields.text === '';
  return (
    <Dialog
      title="Find"
      modal={false}
      onCancel={() => close()}
      initialFocus={openedWithText ? button : input}
      anchor={dialogAnchor(props)}
      className="e68-find-dialog e68-find-dialog--find"
      footer={
        <>
          <Button
            ref={button}
            caption={FIND_BUTTON_CAPTION}
            isDefault={!empty}
            disabled={empty}
            onClick={() => void model.findNextFromFindDialog()}
          />
          <Button caption="Cancel" onClick={() => close()} />
        </>
      }
    >
      <div className="e68-find-dialog__body">
        <TextField
          label="Fi&nd what:"
          value={fields.text}
          onChange={(text) => model.setFind({ text })}
          inputRef={input}
          widthCh={28}
        />
        <Checkbox
          label="Match &whole word only"
          checked={fields.wholeWord}
          onChange={(wholeWord) => model.setFind({ wholeWord })}
        />
        <Checkbox
          label="Match &case"
          checked={fields.matchCase}
          onChange={(matchCase) => model.setFind({ matchCase })}
        />
      </div>
    </Dialog>
  );
}
