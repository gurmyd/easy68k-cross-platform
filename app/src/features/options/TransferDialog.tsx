// Options > Import/Export Settings... of Editor and Simulator mode (dialog id `settings.transfer`;
// ARCHITECTURE.md 3.10, 5.6, 1.5). The port's own dialog: one row per file of the original
// (settings.dat, sim68K.dat, template.NEW) with `Import...` and `Export...`, a status line, and
// `Close`. An import takes effect at once in every window (transfer.ts); there is nothing to cancel.
//
// Owner: E4.

import { useState } from 'react';
import type { DialogProps as FeatureDialogProps } from '../../contracts';
import { useAppContext } from '../../state/context';
import { Button, Dialog } from '../../ui/components';
import { exportFile, importFile, type TransferOutcome } from './transfer';
import {
  TRANSFER_CLOSE_CAPTION,
  TRANSFER_EXPORT_CAPTION,
  TRANSFER_FILES,
  TRANSFER_IMPORT_CAPTION,
  TRANSFER_INTRO,
  TRANSFER_TITLE,
  type TransferFileKind,
} from './texts';
import './options.css';

export function TransferDialog({ close }: FeatureDialogProps<Record<string, never>, void>) {
  const ctx = useAppContext();
  const [outcome, setOutcome] = useState<TransferOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: typeof importFile, kind: TransferFileKind) => {
    setBusy(true);
    try {
      const result = await action(ctx, kind);
      if (result.status !== 'cancelled') setOutcome(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={TRANSFER_TITLE}
      width={560}
      className="e68-options-dialog"
      onCancel={() => close()}
      footer={<Button caption={TRANSFER_CLOSE_CAPTION} isDefault onClick={() => close()} />}
    >
      <div className="e68-options" data-e68-options="transfer">
        <p className="e68-options__intro">{TRANSFER_INTRO}</p>
        <div className="e68-options__files" role="group" aria-label={TRANSFER_TITLE}>
          {TRANSFER_FILES.map((file) => (
            <div key={file.kind} className="e68-options__file" data-e68-transfer={file.kind}>
              <span>
                {file.caption} <span className="e68-options__file-name">{file.fileName}</span>
              </span>
              <Button
                caption={TRANSFER_IMPORT_CAPTION}
                aria-label={file.importTitle}
                disabled={busy}
                onClick={() => void run(importFile, file.kind)}
              />
              <Button
                caption={TRANSFER_EXPORT_CAPTION}
                aria-label={file.exportTitle}
                disabled={busy}
                onClick={() => void run(exportFile, file.kind)}
              />
            </div>
          ))}
        </div>
        <p className="e68-options__status" role="status" data-status={outcome?.status ?? ''}>
          {outcome?.message ?? ''}
        </p>
      </div>
    </Dialog>
  );
}
