// The dialog `files.moveTo` (ARCHITECTURE-PLUS P3.2.4): `Move To`, a list of the folders of every
// store except "Opened from this computer", indented by depth, with the kit's list keys; the
// buttons `Move` (or `Copy` when the chosen folder is in another store) and `Cancel`. The folders
// are found before it opens (move.ts moveTargets); a folder the items cannot go to (their own
// folder, .git) is shown but cannot be chosen. It answers the chosen folder or null. Owner: N5.

import { useRef, useState } from 'react';
import type { DialogProps, VPath } from '../../contracts';
import { Button, Dialog, ListBox } from '../../ui/components';
import { refusedTarget, transferModeOf, type MoveTarget } from './move';
import { CANCEL_BUTTON, COPY_BUTTON, MOVE_BUTTON, MOVE_TO_DIALOG_TITLE, MOVE_TO_LIST_LABEL } from './texts';

export interface MoveToDialogProps {
  items: VPath[];
  targets: MoveTarget[];
}

export type MoveToDialogResult = VPath | null;

/** The caption of the dialog's first button for a chosen folder. */
export function moveToButton(items: readonly VPath[], target: VPath | null): string {
  return target !== null && transferModeOf(items, target) === 'copy' ? COPY_BUTTON : MOVE_BUTTON;
}

export function MoveToDialog({ props, close }: DialogProps<MoveToDialogProps, MoveToDialogResult>) {
  const allowed = (path: VPath) => !refusedTarget(props.items, path);
  const [chosen, setChosen] = useState<VPath | null>(props.targets.find((t) => allowed(t.path))?.path ?? null);
  const listHolder = useRef<HTMLDivElement>(null);
  const items = props.targets.map((target) => ({
    value: target.path,
    label: target.label,
    disabled: !allowed(target.path),
    render: () => <span style={{ paddingInlineStart: `calc(var(--sp-4) * ${target.depth})` }}>{target.label}</span>,
  }));
  // The list has the focus when the dialog opens (the kit's tree keys move in it).
  const listFocus = {
    get current() {
      return listHolder.current?.querySelector<HTMLElement>('[role=listbox]') ?? null;
    },
  };
  const ok = chosen !== null && allowed(chosen);
  return (
    <Dialog
      title={MOVE_TO_DIALOG_TITLE}
      onCancel={() => close(null)}
      width={420}
      initialFocus={listFocus}
      footer={
        <>
          <Button caption={moveToButton(props.items, chosen)} isDefault disabled={!ok} onClick={() => close(chosen)} />
          <Button caption={CANCEL_BUTTON} onClick={() => close(null)} />
        </>
      }
    >
      <div ref={listHolder}>
        <ListBox
          items={items}
          value={chosen}
          onChange={setChosen}
          onActivate={(value) => {
            if (allowed(value)) close(value);
          }}
          label={MOVE_TO_LIST_LABEL}
          rows={12}
        />
      </div>
    </Dialog>
  );
}
