// A restore from the Trash with its questions (ARCHITECTURE-PLUS P3.3.8, P3.3.4, P3.2.7, P4.4).
// Owner: N0 > N4.
//
// One function for the Trash dialog (N4, title `Restore`) and the Files panel's Undo of a delete
// (N5, title `Undo`), since a feature may not import another. Pure: it reaches files only through
// `history.restoreTrash`, which writes through the Vfs, and asks only through `dialogs.messageBox`.
//
// For each item, one after the other, `restoreTrash` calls back for each of its files in the fixed
// order of P3.3.4:
//
//   before(path)   the open-document check: a document of this window open at `path` and modified
//                  is skipped with `"prog.X68" has changes that are not saved. ...` (the file stays
//                  in the Trash, `guard` never runs for it); otherwise the file is written.
//   ask(path)      something is at the place: `"demo/prog.X68" exists. Replace it with the one from
//                  the Trash? ...` (`Yes` replace, `No` beside as `prog (restored).X68`, `Cancel`
//                  stops this item and every item after it). Its second sentence is `This cannot be
//                  undone.` when the history is not `ready` (P3.3.4).
//   confirm(path)  the question of P3.3.4 when `guard` cannot keep a copy of the file it replaces.
//                  When `ask` already said `This cannot be undone.` for that path, it answers `Yes`
//                  without asking, so that one file is asked about once (P3.3.4).
//   after(path)    an open, unmodified document at `path` is reloaded.
//   fallback(item) the item's store is not mounted: offer My Programs/Restored (`Yes`, `No`).
//
// Then, for the item: `gone` shows P3.2.7's `... it is no longer in the Trash.`; a failed write
// shows its message (icon `error`); a restore that wrote some of the item's files but not all ends
// with `2 of 5 files were restored. ...` (P3.3.8).

import type { DialogService, DocumentService, HistoryService, TrashItemInfo, VPath, Vfs } from '../../contracts';
import { cannotKeepQuestion } from '../history/texts';
import { basename, childPath, dirname, foldCase, mountOf } from '../paths/winpath';
import {
  RESTORED_FOLDER,
  existsQuestion,
  folderNotOpen,
  noLongerInTrash,
  partlyRestored,
  placeUnreachable,
  restoredName,
  unsavedChanges,
} from './texts';

export interface RestoreFlowDeps {
  history: HistoryService;
  dialogs: DialogService; // messageBox, for the texts of P3.3.8
  documents: DocumentService; // open documents: skip when modified, reload when not
  placeShort(path: VPath): string;
  /**
   * Optional (an addition of N4, errata N4): the files, so that the replace question can name the
   * first free `prog (restored N).X68` as the store will write it. Without it the question names
   * `prog (restored).X68`.
   */
  vfs?: Pick<Vfs, 'stat'>;
}

/** The folder of My Programs that takes the files of an item whose store is not mounted (P3.3.8). */
export const RESTORED_FALLBACK: VPath = `/browser/${RESTORED_FOLDER}`;

/** The name of an opened folder that is not open now, when the store does not tell it. */
const UNKNOWN_FOLDER_NAME = 'opened folder';

/** True when two paths name one file: the browser store compares letter case folded (P4.3). */
function samePath(a: VPath, b: VPath): boolean {
  if (a === b) return true;
  return mountOf(a) === 'browser' && mountOf(b) === 'browser' && foldCase(a) === foldCase(b);
}

/** The open document of this window at `path`, or null. */
function openDocumentAt(documents: DocumentService, path: VPath) {
  return documents.list().find((doc) => doc.path !== null && samePath(doc.path, path)) ?? null;
}

/** The first name the store will give a file restored beside `path` (P3.3.8, errata N3). */
async function besideName(deps: RestoreFlowDeps, path: VPath): Promise<string> {
  const name = basename(path);
  if (!deps.vfs) return restoredName(name, 1);
  const folder = dirname(path);
  for (let n = 1; n < 1000; n++) {
    const candidate = restoredName(name, n);
    const taken = await deps.vfs.stat(childPath(folder, candidate)).then(
      (stat) => stat !== null,
      () => false,
    );
    if (!taken) return candidate;
  }
  return restoredName(name, 1);
}

/** The question when an item's store is not mounted (P3.3.8). */
function fallbackText(deps: RestoreFlowDeps, item: TrashItemInfo): string {
  const name = basename(item.path);
  if (item.path === '/folder' || item.path.startsWith('/folder/')) {
    const folderName = (item as TrashItemInfo & { folderName?: string }).folderName ?? UNKNOWN_FOLDER_NAME;
    return folderNotOpen(name, folderName);
  }
  return placeUnreachable(name, deps.placeShort(dirname(item.path)));
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
  const say = (text: string, icon: 'information' | 'error' = 'information') =>
    deps.dialogs.messageBox({ title, text, icon, buttons: ['OK'] });
  let cancelled = false;

  for (const item of items) {
    if (cancelled) break;
    /** Paths whose replace question already said `This cannot be undone.` (P3.3.4). */
    const toldCannotUndo = new Set<VPath>();
    let outcome: Awaited<ReturnType<HistoryService['restoreTrash']>>;
    try {
      outcome = await deps.history.restoreTrash(item.id, {
        before: async (path) => {
          const doc = openDocumentAt(deps.documents, path);
          if (doc?.modified) {
            await say(unsavedChanges(basename(path)));
            return 'skip';
          }
          return 'write';
        },
        ask: async (path) => {
          const ready = deps.history.state() === 'ready';
          const answer = await deps.dialogs.messageBox({
            title,
            text: existsQuestion(deps.placeShort(path), await besideName(deps, path), ready),
            icon: 'confirmation',
            buttons: ['Yes', 'No', 'Cancel'],
          });
          if (answer === 'Yes') {
            if (!ready) toldCannotUndo.add(path);
            return 'replace';
          }
          if (answer === 'No') return 'beside';
          cancelled = true;
          return 'cancel';
        },
        confirm: async (path) => {
          if (toldCannotUndo.has(path)) return true;
          const answer = await deps.dialogs.messageBox({
            title,
            text: cannotKeepQuestion('replace', basename(path), false),
            icon: 'warning',
            buttons: ['Yes', 'No'],
          });
          return answer === 'Yes';
        },
        after: async (path) => {
          const doc = openDocumentAt(deps.documents, path);
          if (doc && !doc.modified) await deps.documents.reload(doc.id);
        },
        fallback: async (info) => {
          const answer = await deps.dialogs.messageBox({
            title,
            text: fallbackText(deps, info),
            icon: 'confirmation',
            buttons: ['Yes', 'No'],
          });
          return answer === 'Yes' ? RESTORED_FALLBACK : null;
        },
      });
    } catch (error) {
      // restoreTrash resolves for everything a restore can meet; a rejection is shown as a failed
      // write would be, and the item stays in the Trash.
      await say(error instanceof Error ? error.message : String(error), 'error');
      continue;
    }

    if (outcome.gone) {
      result.gone.push(item.path);
      await say(noLongerInTrash(deps.placeShort(item.path)));
      continue;
    }
    result.restored.push(...outcome.restored);
    result.left.push(...outcome.left);
    result.lost.push(...outcome.lost);
    if (outcome.error !== undefined) await say(outcome.error, 'error');
    const total = outcome.restored.length + outcome.left.length + outcome.lost.length;
    if (outcome.restored.length > 0 && total > outcome.restored.length) {
      await say(partlyRestored(outcome.restored.length, total, outcome.lost.length));
    }
  }
  return result;
}
