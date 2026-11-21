// Feature "options": Assembler Options, Editor Options and the settings import and export
// (ARCHITECTURE.md 3.10, 1.4 note 8, 1.5; editor-ui §11, §12; sim-ui §14.3).
//
// Contributes:
//   dialogs   `options.assembler` (modeless), `options.editor` (modal), `settings.transfer` (modal)
//   commands  `ed.options.assembler`  Options > Assembler Options... (always enabled)
//             `ed.options.editor`     Options > Editor Options... (enabled while a document is open,
//                                     state E of editor-ui §2.7)
//             `ed.options.transfer`   Options > Import/Export Settings... (Editor mode)
//             `sim.options.transfer`  Options > Import/Export Settings... (Simulator mode)
//
// The logic is in model.ts (the dialogs' drafts), actions.ts (what the commands and buttons do
// with the context) and transfer.ts (import and export); the files of the original are read and
// written by core/settings/dat-codec. Every setting is read and written through ctx.settings.
//
// Owner: W3 > E4.

import type { FeatureModule } from '../../contracts';
import { showAssemblerOptions, showEditorOptions, showTransfer } from './actions';
import { AssemblerOptionsDialog } from './AssemblerOptionsDialog';
import { EditorOptionsDialog } from './EditorOptionsDialog';
import { ASSEMBLER_OPTIONS_DIALOG_ID, EDITOR_OPTIONS_DIALOG_ID, TRANSFER_DIALOG_ID } from './texts';
import { TransferDialog } from './TransferDialog';

export const feature: FeatureModule = {
  id: 'options',
  dialogs: {
    [ASSEMBLER_OPTIONS_DIALOG_ID]: AssemblerOptionsDialog,
    [EDITOR_OPTIONS_DIALOG_ID]: EditorOptionsDialog,
    [TRANSFER_DIALOG_ID]: TransferDialog,
  },
  commands: {
    'ed.options.assembler': { run: (ctx) => showAssemblerOptions(ctx) },
    'ed.options.editor': {
      run: (ctx) => showEditorOptions(ctx),
      enabled: (state) => state.documents.activeId !== null,
    },
    'ed.options.transfer': { run: (ctx) => showTransfer(ctx) },
    'sim.options.transfer': { run: (ctx) => showTransfer(ctx) },
  },
};
