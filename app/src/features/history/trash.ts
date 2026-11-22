// The logic of the Trash dialog (ARCHITECTURE-PLUS P3.3.8, P3.3.7). Owner: N4.
//
// Plain functions, tested under Node; TrashDialog.tsx draws what they return. `Restore` goes
// through restoreWithQuestions (core/trash-restore), the same function the Files panel's Undo of a
// delete calls (N5).

import type { DialogService, HistoryService, HistoryState, TrashItemInfo, VPath } from '../../contracts';
import { formatSize } from '../../core/history/size';
import {
  DELETE_HISTORY_BUTTON,
  DELETE_HISTORY_QUESTION,
  historyUnreadable,
  unreadableEntries,
} from '../../core/history/texts';
import { basename, dirname } from '../../core/paths/winpath';
import {
  CAUSE_SHOWN_AS,
  DELETE_FOR_GOOD_BUTTON,
  EMPTY_TRASH_BUTTON,
  TRASH_EMPTY,
  deleteForGoodQuestion,
  emptyTrashQuestion,
} from './texts';
import { formatKept } from './versions';

/** What the Trash dialog shows. */
export type TrashView =
  | { kind: 'unavailable'; text: string }
  | { kind: 'list'; lines: string[]; items: TrashItemInfo[]; empty: string | null };

/** Pure: the dialog's content (P3.3.8, P3.3.7). */
export function describeTrash(input: {
  state: HistoryState;
  unreadable: number;
  detail: string;
  items: readonly TrashItemInfo[];
}): TrashView {
  if (input.state === 'unavailable') return { kind: 'unavailable', text: historyUnreadable(input.detail) };
  const lines = input.unreadable > 0 ? [unreadableEntries(input.unreadable)] : [];
  return { kind: 'list', lines, items: [...input.items], empty: input.items.length === 0 ? TRASH_EMPTY : null };
}

/** One row of the list: `Name`, `Was in`, `Why`, `When`, `Size`. */
export interface TrashRow {
  id: string;
  name: string;
  wasIn: string;
  why: string;
  when: string;
  size: string;
}

/** Pure: the row of an item. `Size` is TrashItemInfo.bytes (P3.3.8). */
export function trashRow(item: TrashItemInfo, placeShort: (path: VPath) => string, locale?: string): TrashRow {
  let name: string = item.path;
  let wasIn: string = item.path;
  try {
    name = basename(item.path);
    wasIn = placeShort(dirname(item.path));
  } catch {
    // A path the store gives is a VPath; anything else is shown as it is.
  }
  return {
    id: item.id,
    name,
    wasIn,
    why: CAUSE_SHOWN_AS[item.cause],
    when: formatKept(item.deletedAt, locale),
    size: formatSize(item.bytes),
  };
}

type Ask = Pick<DialogService, 'messageBox'>;

async function yes(dialogs: Ask, title: string, text: string): Promise<boolean> {
  return (await dialogs.messageBox({ title, text, icon: 'confirmation', buttons: ['Yes', 'No'] })) === 'Yes';
}

/**
 * The store rejects a change it could not make (errata N3, "When a transaction fails"): its message
 * is shown under the command's caption, as for Delete History and Trash, and nothing is reported as
 * done (the list, read again, still shows the items).
 */
async function failed(dialogs: Ask, title: string, error: unknown): Promise<false> {
  await dialogs.messageBox({
    title,
    text: error instanceof Error ? error.message : String(error),
    icon: 'error',
    buttons: ['OK'],
  });
  return false;
}

/** `Delete for Good` on the selected items: the question, then dropTrash. True when dropped. */
export async function deleteForGood(
  deps: { history: HistoryService; dialogs: Ask },
  items: readonly TrashItemInfo[],
): Promise<boolean> {
  if (items.length === 0) return false;
  if (!(await yes(deps.dialogs, DELETE_FOR_GOOD_BUTTON, deleteForGoodQuestion(items.length)))) return false;
  try {
    await deps.history.dropTrash(items.map((item) => item.id));
  } catch (error) {
    return failed(deps.dialogs, DELETE_FOR_GOOD_BUTTON, error);
  }
  return true;
}

/** `Empty Trash`: the question with the count and size of the items listed, then drops them. */
export async function emptyTrash(
  deps: { history: HistoryService; dialogs: Ask },
  listed: readonly TrashItemInfo[],
): Promise<boolean> {
  if (listed.length === 0) return false;
  const size = formatSize(listed.reduce((sum, item) => sum + item.bytes, 0));
  if (!(await yes(deps.dialogs, EMPTY_TRASH_BUTTON, emptyTrashQuestion(listed.length, size)))) return false;
  try {
    await deps.history.dropTrash(listed.map((item) => item.id));
  } catch (error) {
    return failed(deps.dialogs, EMPTY_TRASH_BUTTON, error);
  }
  return true;
}

/** P3.3.7's `Delete History and Trash`: the question, then deleteAll. True when deleted. */
export async function deleteHistoryAndTrash(deps: { history: HistoryService; dialogs: Ask }): Promise<boolean> {
  if (!(await yes(deps.dialogs, DELETE_HISTORY_BUTTON, DELETE_HISTORY_QUESTION))) return false;
  try {
    await deps.history.deleteAll();
  } catch (error) {
    return failed(deps.dialogs, DELETE_HISTORY_BUTTON, error);
  }
  return true;
}
