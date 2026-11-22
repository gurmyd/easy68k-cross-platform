// Feature "assemble": Assemble Source, the Messages panel of Editor mode, the inline markers' data,
// the status dialog with Execute and Load L68, and Clear Error Messages (ARCHITECTURE.md 4.9, 3.8.3,
// 5.3, 9.4 E5; editor-ui §7.3, §10, §4.2).
//
//   ed.project.assemble   F9, Project > Assemble Source..., the toolbar button: assemble.ts runs
//                         4.9 steps 1-9, then the dialog `asm.status` opens; its answer is acted on
//                         here: Execute switches to Simulator mode and loads the S-record through the
//                         run controller with the origin 'execute' (a fresh simulator, no run;
//                         note 20); Load L68 opens the listing as a document (editor-ui §10.7).
//   ed.msg.clear          the message list's context menu: the active document's rows go, and
//                         with them its markers.
//
// The inline markers are drawn by the editor component (E2, ui/editor/markers.ts) from
// AppState.messages, which this feature writes; the height of the message list is the shell's
// (state/layout.ts, messagesPaneHeight) from AppState.messages and AppState.assemble.
//
// Exported names are contract (section 8, "Stubs"): app/src/features/index.ts imports `feature`.
//
// Owner: W3 > E5.

import type { AppContext, AppState, CommandHandler, FeatureModule, VPath } from '../../contracts';
import { focusPanel } from '../../state/panels';
import { assembleDocument, type AssembleDeps, type StatusDialogProps, type StatusDialogResult } from './assemble';
import { MessagesPanel } from './MessagesPanel';
import { untitledFolder } from './options';
import { STATUS_DIALOG_ID, StatusDialog } from './StatusDialog';

/** The services of the context that one assembly uses. */
export function assembleDeps(ctx: AppContext): AssembleDeps {
  return {
    documents: ctx.documents,
    vfs: ctx.vfs,
    asm: ctx.asm,
    settings: ctx.settings,
    store: ctx.store,
    clock: ctx.clock,
    messageBox: (request) => ctx.dialogs.messageBox(request),
    untitledDir: untitledFolder(ctx.platform),
  };
}

/** Windows whose assembly is running: a second F9 meanwhile is ignored (4.9, last paragraph). */
const busy = new WeakSet<AppContext>();

function setBusy(ctx: AppContext, on: boolean): void {
  if (on) busy.add(ctx);
  else busy.delete(ctx);
  // `enabled` depends on this: menus and toolbars ask again (contracts/commands.ts).
  ctx.store.setState((state) => ({ ...state }));
}

/**
 * Whether Assemble is available (editor-ui §2.7, state A): a document is active and a source
 * document is open. The original's flag is global, so a list document that is active while a
 * source is open can be assembled too (its quirk, kept: it changes no program's result).
 */
export function assembleEnabled(state: AppState): boolean {
  const { items, activeId } = state.documents;
  return activeId !== null && items.some((doc) => doc.kind === 'source');
}

/** Execute (editor-ui §10.6; 1.4 note 20): Simulator mode, a fresh simulator, the S-record loaded, not run. */
export async function executeProgram(ctx: AppContext, sRecord: VPath): Promise<void> {
  if (ctx.store.getState().mode !== 'simulator') await ctx.commands.run('app.mode.set', 'simulator');
  try {
    await ctx.sim.controller.open(sRecord, 'execute');
  } finally {
    // The status dialog returns the focus to the editor, which Simulator mode hides: the focus would
    // be nowhere. It goes to the Listing, as after a stop in trace mode (2.10; Q1-2).
    focusPanel(ctx, 'listing');
  }
}

/** Opens the status dialog and does what its answer asks. */
export async function showStatus(ctx: AppContext, status: StatusDialogProps): Promise<void> {
  const answer = await ctx.dialogs.open<StatusDialogProps, StatusDialogResult>(STATUS_DIALOG_ID, status, {
    modal: true,
  });
  if (answer === 'execute' && status.executeEnabled) await executeProgram(ctx, status.sRecordPath);
  else if (answer === 'loadL68') await ctx.documents.open(status.listingPath);
}

export const assembleCommand: CommandHandler = {
  async run(ctx) {
    const id = ctx.store.getState().documents.activeId;
    if (id === null || busy.has(ctx)) return;
    setBusy(ctx, true);
    let outcome;
    try {
      outcome = await assembleDocument(assembleDeps(ctx), id);
    } finally {
      setBusy(ctx, false);
    }
    if (outcome.kind === 'done') await showStatus(ctx, outcome.status);
  },
  enabled: (state, ctx) => assembleEnabled(state) && !busy.has(ctx),
};

export const clearMessagesCommand: CommandHandler = {
  run(ctx) {
    const id = ctx.store.getState().documents.activeId;
    if (id === null) return;
    ctx.store.setState((state) => ({ ...state, messages: { ...state.messages, [id]: [] } }));
  },
  enabled: (state) => {
    const id = state.documents.activeId;
    return id !== null && (state.messages[id]?.length ?? 0) > 0;
  },
};

export const feature: FeatureModule = {
  id: 'assemble',
  commands: {
    'ed.project.assemble': assembleCommand,
    'ed.msg.clear': clearMessagesCommand,
  },
  panels: [{ id: 'messages', title: 'Messages', mode: 'editor', component: MessagesPanel }],
  dialogs: { [STATUS_DIALOG_ID]: StatusDialog },
};
