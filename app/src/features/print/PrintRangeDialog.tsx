// The print range question of File > Print (dialog id `print.range`). Owner: E6.
//
// The original's print dialog (PrintDialog, Options = [poSelection]) lets the user print All or
// the Selection (editor-ui §13.1 step 1). The system print dialog that the port opens afterwards
// (Platform.print) cannot offer the editor's selection, so this modal dialog asks first, and only
// while the document has a selection. `All` is preselected, as the Windows dialog does. The
// captions are those of the Windows print dialog's range group.

import { useState } from 'react';
import type { DialogProps as FeatureDialogProps } from '../../contracts';
import { Button, Dialog, RadioGroup } from '../../ui/components';
import type { PrintRange } from './print';

export interface PrintRangeProps {
  /** True when the Selection choice is offered (the document has a selection). */
  selection: boolean;
}

export function PrintRangeDialog({ props, close }: FeatureDialogProps<PrintRangeProps, PrintRange | null>) {
  const [range, setRange] = useState<PrintRange>('all');
  return (
    <Dialog
      title="Print"
      onCancel={() => close(null)}
      footer={
        <>
          <Button caption="OK" isDefault onClick={() => close(range)} />
          <Button caption="Cancel" onClick={() => close(null)} />
        </>
      }
    >
      <RadioGroup<PrintRange>
        label="Print range"
        value={range}
        onChange={setRange}
        options={[
          { value: 'all', label: '&All' },
          { value: 'selection', label: '&Selection', disabled: !props?.selection },
        ]}
      />
    </Dialog>
  );
}
