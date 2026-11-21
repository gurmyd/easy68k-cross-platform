// Feature "print": Print and Printer Setup of Editor mode (editor-ui §13; ARCHITECTURE.md 1.4
// note 2). Owner: W3 > E6.
//
//   commands  ed.file.print         the selection or the whole document through the system print
//                                   dialog (Platform.print); enabled while a document is open
//             ed.file.printerSetup  the same system print dialog (note 2); always enabled
//   dialogs   `print.range`         All / Selection, asked only while the document has a selection
//
// The print document itself is built by core/print; the steps are in print.ts.

import type { FeatureModule } from '../../contracts';
import { PRINT_RANGE_DIALOG_ID, printActiveDocument, printerSetup } from './print';
import { PrintRangeDialog } from './PrintRangeDialog';

export const feature: FeatureModule = {
  id: 'print',
  dialogs: { [PRINT_RANGE_DIALOG_ID]: PrintRangeDialog },
  commands: {
    'ed.file.print': {
      enabled: (state) => state.documents.activeId !== null,
      async run(ctx) {
        await printActiveDocument(ctx);
      },
    },
    'ed.file.printerSetup': {
      async run(ctx) {
        await printerSetup(ctx);
      },
    },
  },
};
