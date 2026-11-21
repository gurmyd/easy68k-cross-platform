// What the commands and dialogs of this feature do with the application context: open the
// dialogs, confirm them, open their help page. Tested under Node with createTestApplication
// (options.test.ts). Owner: E4.

import type { AppContext } from '../../contracts';
import { applyAsmDraft, applyEditorDraft, documentPatch, needsSim68KQuestion, recheckRequired } from './model';
import type { AsmDraft, EditorDraft, EditorOptionsProps } from './model';
import {
  ASSEMBLER_OPTIONS_DIALOG_ID,
  EDITOR_OPTIONS_DIALOG_ID,
  OPTIONS_HELP_PAGE,
  SIM68K_QUESTION,
  TRANSFER_DIALOG_ID,
} from './texts';

/* ---------------------------------------------------------------- per-window state */

/** What this feature remembers per window: the tab Editor Options showed last, focus requests. */
interface OptionsState {
  /** editor-ui §11.2: the tab that was showing last time is shown again; the first time Colors. */
  editorTab: 'general' | 'colors';
  /** Called when Assembler Options is asked for while it is open (it comes to the front). */
  focusAssembler: (() => void) | null;
}

const states = new WeakMap<AppContext, OptionsState>();

export function optionsStateOf(ctx: AppContext): OptionsState {
  let state = states.get(ctx);
  if (!state) {
    state = { editorTab: 'colors', focusAssembler: null };
    states.set(ctx, state);
  }
  return state;
}

/** True while a dialog with this id is open in the window. */
export function dialogOpen(ctx: AppContext, id: string): boolean {
  return ctx.store.getState().dialogs.stack.some((dialog) => dialog.id === id);
}

/* ---------------------------------------------------------------- help (editor-ui §15.2, note 8) */

/**
 * F1 in either option dialog and the Help button of Editor Options: `options.htm` (1.4 note 8),
 * through the Help command, which the dialog's own code may run while it is modal
 * (docs/requests/H1-help-from-dialogs.md).
 */
export function openOptionsHelp(ctx: AppContext): void {
  void ctx.commands.run('ed.help.help', OPTIONS_HELP_PAGE, { allowInModal: true });
}

/* ---------------------------------------------------------------- Assembler Options (§11.1) */

/** Options > Assembler Options...: shows the modeless dialog, or brings it to the front. */
export function showAssemblerOptions(ctx: AppContext): void {
  if (dialogOpen(ctx, ASSEMBLER_OPTIONS_DIALOG_ID)) {
    optionsStateOf(ctx).focusAssembler?.();
    return;
  }
  void ctx.dialogs.open(ASSEMBLER_OPTIONS_DIALOG_ID, {}, { modal: false });
}

/**
 * OK of Assembler Options (optionsS.cpp:54-106). With Generate S-Record or Generate List File
 * unchecked the Sim68K question comes first: Yes writes the draft and closes; No re-checks both
 * boxes and the dialog stays open. Resolves to what the dialog does next.
 */
export async function confirmAssemblerOptions(
  ctx: AppContext,
  draft: AsmDraft,
): Promise<{ close: true } | { close: false; draft: AsmDraft }> {
  if (needsSim68KQuestion(ctx.settings.get().editor, draft)) {
    const answer = await ctx.dialogs.messageBox(SIM68K_QUESTION);
    if (answer !== 'Yes') return { close: false, draft: recheckRequired(draft) };
  }
  ctx.settings.update((settings) => applyAsmDraft(settings, draft));
  return { close: true };
}

/**
 * `&Save Template` (optionsS.cpp:126-130): writes the box to template.NEW at once, whatever OK or
 * Cancel do later. The port's template.NEW is `EditorSettings.template`.
 */
export function saveTemplate(ctx: AppContext, text: string): void {
  ctx.settings.update((settings) => ({ ...settings, editor: { ...settings.editor, template: text } }));
}

/* ---------------------------------------------------------------- Editor Options (§11.2) */

/**
 * Options > Editor Options...: the modal dialog for the active document. OK resolves to the draft,
 * which is written then (settings, and the active document's font and tabs); Cancel to null, and
 * nothing changes.
 */
export async function showEditorOptions(ctx: AppContext): Promise<void> {
  const active = ctx.documents.active();
  if (!active) return;
  const props: EditorOptionsProps = {
    document: {
      id: active.id,
      fontName: active.fontName,
      fontSize: active.fontSize,
      tabType: active.tabType,
      tabSize: active.tabSize,
    },
  };
  const draft = await ctx.dialogs.open<EditorOptionsProps, EditorDraft | null>(EDITOR_OPTIONS_DIALOG_ID, props);
  if (draft) applyEditorOptions(ctx, active.id, draft);
}

/** OK of Editor Options (editorOptions.cpp:62-171): the document first, then the settings. */
export function applyEditorOptions(ctx: AppContext, documentId: string, draft: EditorDraft): void {
  const patch = documentPatch(ctx.settings.get().editor, draft);
  if (ctx.documents.list().some((doc) => doc.id === documentId)) ctx.documents.update?.(documentId, patch);
  ctx.settings.update((settings) => applyEditorDraft(settings, draft));
}

/* ---------------------------------------------------------------- settings.transfer */

/** Options > Import/Export Settings... of either mode. */
export function showTransfer(ctx: AppContext): void {
  void ctx.dialogs.open(TRANSFER_DIALOG_ID, {});
}
