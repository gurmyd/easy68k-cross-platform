// Search > Find... of Simulator mode (dialog id `sim.find`; sim-ui §6.7, findDialogS.dfm/.cpp).
//
// A modeless dialog captioned `Find`: the label `Fi&nd what:`, an edit box, the default button
// `Find  (F3)` (disabled while the edit box is empty) and `Cancel`. The search rules and the
// remembered row are in find-model.ts; the selection and the scrolling in SimMainModel.
//
//   - Shown: the next button press searches from the top; with text in the box the button has the
//     focus, otherwise the edit box.
//   - Text changed: the next button press searches from the top.
//   - F3 while the dialog has the focus: searches on from the last hit (a quirk, kept).
//   - Cancel and Escape close it; the text is kept for the next time.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { DialogProps as FeatureDialogProps } from '../../contracts';
import { useAppContext } from '../../state/context';
import { useStoreValue } from '../../state/store';
import { Button, Dialog, TextField } from '../../ui/components';
import { simMainOf } from './model';

export const FIND_DIALOG_ID = 'sim.find';
export const FIND_BUTTON_CAPTION = 'Find  (F3)';

export function FindDialog({ close }: FeatureDialogProps<Record<string, never>, void>) {
  const ctx = useAppContext();
  const model = simMainOf(ctx);
  const [text, setText] = useState(model.findText);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const focusSerial = useStoreValue(model.view, (state) => state.findFocus);
  const firstSerial = useRef(focusSerial);
  const [initialText] = useState(model.findText);

  // FormShow: the next press of the button searches from the top.
  useEffect(() => model.finder.restart(), [model]);

  // Search > Find... again while the dialog is open: it comes to the front with the focus.
  useEffect(() => {
    if (focusSerial !== firstSerial.current) input.current?.focus();
  }, [focusSerial]);

  const change = (next: string) => {
    setText(next);
    model.findText = next;
    model.finder.restart();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'F3' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      model.findF3(text);
    }
  };

  // KeyPreview = True: F3 acts wherever the focus is inside the dialog. React events bubble out of
  // the dialog's layer to this wrapper.
  return (
    <span className="e68-find__keys" onKeyDown={onKeyDown}>
      <Dialog
        title="Find"
        modal={false}
        onCancel={() => close()}
        initialFocus={initialText === '' ? input : button}
        anchor={{ top: 300, left: 360 }}
        footer={
          <>
            <Button
              ref={button}
              caption={FIND_BUTTON_CAPTION}
              isDefault={text !== ''}
              disabled={text === ''}
              onClick={() => model.findButton(text)}
            />
            <Button caption="Cancel" onClick={() => close()} />
          </>
        }
      >
        <div className="e68-find">
          <TextField label="Fi&nd what:" value={text} onChange={change} inputRef={input} widthCh={28} />
        </div>
      </Dialog>
    </span>
  );
}
