// Feature "find": Find, Find Next, Find And Replace of Editor mode (editor-ui §14, §2.2, §20.6;
// ARCHITECTURE.md 1.4 note 7, 2.7). Owner: W3 > E6.
//
//   commands  ed.edit.find      shows the modeless Find dialog; a selection becomes its text
//             ed.edit.findNext  F3: the search with the Find dialog's text and options, shown or not
//             ed.edit.replace   shows the modeless Replace dialog; both its boxes get the selection
//   dialogs   `find`, `replace`
//
// Enabled: Find and Find And Replace while a document is open (the original's flags F and R are
// set by every edit window and cleared with the last, §2.7); Find Next while a document is open and
// the Find text is not empty (Edit1Click). The search rules are in search.ts, the dialogs' state
// and the actions on the document in model.ts.

import type { AppContext, AppState, FeatureModule } from '../../contracts';
import { FindDialog } from './FindDialog';
import { FIND_DIALOG_ID, findModelOf, REPLACE_DIALOG_ID, type FindDialogProps } from './model';
import { ReplaceDialog } from './ReplaceDialog';

const documentOpen = (state: AppState) => state.documents.activeId !== null;
const isOpen = (ctx: AppContext, id: string) => ctx.store.getState().dialogs.stack.some((d) => d.id === id);

export const feature: FeatureModule = {
  id: 'find',
  dialogs: { [FIND_DIALOG_ID]: FindDialog, [REPLACE_DIALOG_ID]: ReplaceDialog },
  commands: {
    'ed.edit.find': {
      enabled: documentOpen,
      run(ctx) {
        findModelOf(ctx).prepareFind();
        if (isOpen(ctx, FIND_DIALOG_ID)) return;
        const props: FindDialogProps = { below: isOpen(ctx, REPLACE_DIALOG_ID) };
        void ctx.dialogs.open(FIND_DIALOG_ID, props, { modal: false });
      },
    },
    'ed.edit.findNext': {
      enabled: (state, ctx) => documentOpen(state) && findModelOf(ctx).canFindNext(),
      async run(ctx) {
        await findModelOf(ctx).findNextFromFindDialog();
      },
    },
    'ed.edit.replace': {
      enabled: documentOpen,
      run(ctx) {
        findModelOf(ctx).prepareReplace();
        if (isOpen(ctx, REPLACE_DIALOG_ID)) return;
        const props: FindDialogProps = { below: isOpen(ctx, FIND_DIALOG_ID) };
        void ctx.dialogs.open(REPLACE_DIALOG_ID, props, { modal: false });
      },
    },
  },
};
