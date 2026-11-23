// What the command `app.additions.options` and the buttons of its dialog do with the application
// context (ARCHITECTURE-PLUS P3.5, P3.3.8). Tested under Node with createTestApplication
// (additions.test.ts). Owner: N7.

import type { AppContext, PlusSettings } from '../../contracts';
import { readPlus, withPlus } from '../../core/plus/settings';
import {
  ADDITIONS_DIALOG_ID,
  DELETE_VERSIONS_CAPTION,
  DELETE_VERSIONS_QUESTION,
  EMPTY_TRASH_CAPTION,
  TRASH_EMPTY_TEXT,
  emptyTrashQuestion,
} from './texts';

/** The command's argument (P3.6): `{ group: 'storage' }` opens the dialog with the focus on Empty Trash. */
export interface AdditionsArg {
  group?: 'storage';
}

/** Props of the dialog `plus.options`. */
export interface AdditionsDialogProps {
  /** The two switches when the dialog opened. */
  initial: PlusSettings;
  /** 'storage': the focus starts on `Empty Trash`. */
  focus: 'storage' | null;
}

/** Result of the dialog: the two boxes on OK, null on Cancel, Escape or the close button. */
export type AdditionsDialogResult = PlusSettings | null;

/** The focus the argument asks for; anything else than `{ group: 'storage' }` asks for none. */
export function focusOf(arg: unknown): 'storage' | null {
  return typeof arg === 'object' && arg !== null && (arg as { group?: unknown }).group === 'storage' ? 'storage' : null;
}

/** The switches the student changed, compared with those shown when the dialog opened. */
export function changedSwitches(initial: PlusSettings, chosen: PlusSettings): Partial<PlusSettings> {
  const change: Partial<PlusSettings> = {};
  if (chosen.viewer !== initial.viewer) change.viewer = chosen.viewer;
  if (chosen.history !== initial.history) change.history = chosen.history;
  return change;
}

/**
 * Options > Port Additions...: the modal dialog. OK stores the switches the student changed in
 * `app.plus` (each is stamped on its own, P4.2, so a switch left alone does not overwrite another
 * window's change); Cancel stores nothing.
 */
export async function showAdditions(ctx: AppContext, arg?: unknown): Promise<void> {
  const initial = readPlus(ctx.settings.get());
  const chosen = await ctx.dialogs.open<AdditionsDialogProps, AdditionsDialogResult>(ADDITIONS_DIALOG_ID, {
    initial,
    focus: focusOf(arg),
  });
  if (!chosen) return;
  applyAdditions(ctx, initial, chosen);
}

/** OK of the dialog. */
export function applyAdditions(ctx: AppContext, initial: PlusSettings, chosen: PlusSettings): void {
  const change = changedSwitches(initial, chosen);
  if (Object.keys(change).length === 0) return;
  ctx.settings.update((settings) => withPlus(settings, change));
}

/** What a button of the Storage group did. 'failed': the store could not do it and said why. */
export type StorageOutcome = 'done' | 'declined' | 'empty' | 'unavailable' | 'failed';

/**
 * The store rejects a change it could not make (errata N3, "When a transaction fails"): its message
 * is shown under the button's caption, as the Trash dialog shows a failed Delete History and Trash
 * (N4), and nothing is reported as done.
 */
async function failed(ctx: AppContext, title: string, error: unknown): Promise<StorageOutcome> {
  await ctx.dialogs.messageBox({
    title,
    text: error instanceof Error ? error.message : String(error),
    icon: 'error',
    buttons: ['OK'],
  });
  return 'failed';
}

/**
 * Runs the Storage group's actions one at a time. An action asked for while another runs (a click
 * on the other button after a Yes, while the store is still working) is not dropped: it runs next;
 * of several such, the latest. Nothing more runs once `alive` says the dialog is gone. `after` is
 * called after each action (the figures are read again).
 */
export function serialActions<T>(
  run: (action: T) => Promise<unknown>,
  alive: () => boolean,
  after: () => void = () => {},
): (action: T) => Promise<void> {
  let busy = false;
  let queued: { action: T } | null = null;
  return async (action: T) => {
    if (busy) {
      queued = { action };
      return;
    }
    busy = true;
    try {
      let next: { action: T } | null = { action };
      while (next && alive()) {
        queued = null;
        try {
          await run(next.action);
        } finally {
          after();
        }
        next = queued;
      }
    } finally {
      queued = null;
      busy = false;
    }
  };
}

/**
 * `Empty Trash` (P3.5, P3.3.8): asks `Delete everything in the Trash for good? (12 items, 1.4 MB)`
 * (`Yes`, `No`) and deletes the items listed. With nothing in the Trash it says so instead of asking
 * (errata N7). Acts at once, not on OK.
 */
export async function emptyTrash(ctx: AppContext): Promise<StorageOutcome> {
  const history = ctx.history;
  if (!history) return 'unavailable';
  const items = await history.trashItems();
  if (items.length === 0) {
    await ctx.dialogs.messageBox({
      title: EMPTY_TRASH_CAPTION,
      text: TRASH_EMPTY_TEXT,
      icon: 'information',
      buttons: ['OK'],
    });
    return 'empty';
  }
  const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
  const answer = await ctx.dialogs.messageBox({
    title: EMPTY_TRASH_CAPTION,
    text: emptyTrashQuestion(items.length, bytes),
    icon: 'confirmation',
    buttons: ['Yes', 'No'],
    // It cannot be undone: No has the focus, so that a stray Enter keeps the Trash (errata N7).
    defaultButton: 'No',
  });
  if (answer !== 'Yes') return 'declined';
  try {
    await history.dropTrash(items.map((item) => item.id));
  } catch (error) {
    return failed(ctx, EMPTY_TRASH_CAPTION, error);
  }
  return 'done';
}

/**
 * `Delete Earlier Versions` (P3.5): asks `Delete all earlier versions of all files for good? Your
 * current files are not affected.` (`Yes`, `No`), then deletes every version of the versions half.
 */
export async function deleteEarlierVersions(ctx: AppContext): Promise<StorageOutcome> {
  const history = ctx.history;
  if (!history) return 'unavailable';
  const answer = await ctx.dialogs.messageBox({
    title: DELETE_VERSIONS_CAPTION,
    text: DELETE_VERSIONS_QUESTION,
    icon: 'confirmation',
    buttons: ['Yes', 'No'],
    // It cannot be undone: No has the focus, so that a stray Enter keeps the versions (errata N7).
    defaultButton: 'No',
  });
  if (answer !== 'Yes') return 'declined';
  try {
    await history.clearVersions();
  } catch (error) {
    return failed(ctx, DELETE_VERSIONS_CAPTION, error);
  }
  return 'done';
}
