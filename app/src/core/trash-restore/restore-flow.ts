// A restore from the Trash with its questions (ARCHITECTURE-PLUS P3.3.8, P4.4). Owner: N0 > N4.
//
// One function for the Trash dialog (N4) and the Files panel's Undo (N5), since a feature may not
// import another.
//
// STUB of N0: restoreTrash is called with `ask` answering 'cancel', `fallback` answering null and
// `confirm` answering false, so that nothing is ever replaced or restored elsewhere; an item that is
// `gone` is named with the no-longer-in-the-Trash text of P3.2.7. N4 adds the questions.

import type { DialogService, DocumentService, HistoryService, VPath } from '../../contracts';
import { noLongerInTrash } from './texts';

export interface RestoreFlowDeps {
  history: HistoryService;
  dialogs: DialogService; // messageBox, for the texts of P3.3.8
  documents: DocumentService; // open documents: skip when modified, reload when not
  placeShort(path: VPath): string;
}

/** Restores the items one after the other with the questions and messages of P3.3.8 and the
 *  question of P3.3.4, titled `title`; shows the no-longer-in-Trash text of P3.2.7 itself for an
 *  item that is `gone`, naming the path given with the id. */
export async function restoreWithQuestions(
  deps: RestoreFlowDeps,
  items: readonly { id: string; path: VPath }[],
  title: 'Restore' | 'Undo',
): Promise<{ restored: VPath[]; left: VPath[]; lost: VPath[]; gone: VPath[] }> {
  const result = { restored: [] as VPath[], left: [] as VPath[], lost: [] as VPath[], gone: [] as VPath[] };
  for (const item of items) {
    const outcome = await deps.history.restoreTrash(item.id, {
      ask: async () => 'cancel',
      fallback: async () => null,
      confirm: async () => false,
    });
    if (outcome.gone) {
      result.gone.push(item.path);
      await deps.dialogs.messageBox({
        title,
        text: noLongerInTrash(deps.placeShort(item.path)),
        icon: 'information',
        buttons: ['OK'],
      });
      continue;
    }
    result.restored.push(...outcome.restored);
    result.left.push(...outcome.left);
    result.lost.push(...outcome.lost);
  }
  return result;
}
