// The small dialog that asks for a name (New Folder..., Rename... in the Files panel). Dialog id
// `files.name` (docs/porting/errata/FS1.md: an addition to the ids of 2.7). Owner: FS1.

import { useRef, useState } from 'react';
import type { DialogProps } from '../../contracts';
import { Button, Dialog, TextField } from '../../ui/components';
import type { NameDialogProps } from './actions';

export function NameDialog({ props, close }: DialogProps<NameDialogProps, string | null>) {
  const [value, setValue] = useState(props.initial);
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      title={props.title}
      onCancel={() => close(null)}
      initialFocus={input}
      width={360}
      footer={
        <>
          <Button caption="OK" isDefault disabled={value.trim() === ''} onClick={() => close(value)} />
          <Button caption="Cancel" onClick={() => close(null)} />
        </>
      }
    >
      <TextField
        label={props.label}
        labelPosition="top"
        value={value}
        onChange={setValue}
        inputRef={input}
        spellCheck={false}
        autoComplete="off"
        onFocus={(event) => {
          // Select the name without its extension, as Explorer does.
          const dot = event.currentTarget.value.lastIndexOf('.');
          event.currentTarget.setSelectionRange(0, dot > 0 ? dot : event.currentTarget.value.length);
        }}
      />
    </Dialog>
  );
}
