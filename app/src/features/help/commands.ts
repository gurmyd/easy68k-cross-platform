// The command handlers of the Help menus and of F1. Owner: H1.
// ARCHITECTURE.md 1.3.2, 1.3.4, 1.5, 9.2 (H1); docs/porting/errata/W3.md entries 8 and 24.

import type { AppContext, CommandHandler, CommandId, FileFilter } from '../../contracts';
import { ENTRY_PAGES, editorHelpPage, simulatorHelpPage } from '../../core/help';
import { panelOf, showPanel } from '../../state/panels';
import { applicationBase } from './controller';
import { copyExamples, examplesFolderExists, loadExampleList, WEB_EXAMPLES_DIR, type ExampleFetch } from './examples';
import { editorHasFocus, readEditorWordContext } from './editor-context';
import { openHelp } from './open';

/** The filters of the Open dialog (editor-ui §6.2), first entry preselected. */
export const OPEN_FILTERS: FileFilter[] = [
  { label: 'EASy68K Source  [.X68]', patterns: ['*.X68'] },
  { label: '68K Source  [.ASM] [.M68]', patterns: ['*.ASM', '*.M68'] },
  { label: 'EASy68K Listing  [.L68]', patterns: ['*.L68'] },
  { label: '68K S Record  [.S68]', patterns: ['*.S68'] },
  { label: 'Any File  [*.*]', patterns: ['*.*'] },
];

const browserFetch: ExampleFetch = (url) => (globalThis as unknown as { fetch: ExampleFetch }).fetch(url);

/** Help > Examples...: web copies into the browser store, desktop asks for a folder (5.8). */
export async function showExamples(ctx: AppContext, fetchFn: ExampleFetch = browserFetch): Promise<void> {
  const base = applicationBase();
  try {
    if (ctx.platform.kind === 'web') {
      if (!(await examplesFolderExists(ctx.vfs))) {
        await copyExamples(ctx.vfs, WEB_EXAMPLES_DIR, await loadExampleList(base, fetchFn), base, fetchFn);
      }
      showPanel(ctx, 'files');
      ctx.dialogs.toast(`The examples are in ${WEB_EXAMPLES_DIR} (Files panel).`);
      return;
    }
    // Desktop: the folder is chosen with the save dialog, as the contracts have no folder chooser
    // (errata H1, "Contract"); the name typed there is the folder to create.
    const chosen = await ctx.fileDialogs.save({
      title: 'Copy the Examples to (folder name)',
      filters: [{ label: 'Folder', patterns: ['*'] }],
      defaultExt: '',
    });
    if (chosen === null) return;
    await copyExamples(ctx.vfs, chosen, await loadExampleList(base, fetchFn), base, fetchFn);
    const files = await ctx.fileDialogs.open({
      title: 'Open File',
      filters: OPEN_FILTERS,
      multiple: false,
      startDir: chosen,
    });
    const first = files?.[0];
    if (first !== undefined) await ctx.documents.open(first);
  } catch (error) {
    await ctx.dialogs.messageBox({
      title: 'Examples',
      text: `The examples could not be copied: ${error instanceof Error ? error.message : String(error)}`,
      icon: 'error',
      buttons: ['OK'],
    });
  }
}

/** An optional page given by the caller: "Help" opens it instead of the introduction. */
function requestedPage(arg: unknown): string | null {
  return typeof arg === 'string' ? arg : null;
}

export const commands: Record<CommandId, CommandHandler> = {
  'ed.help.help': { run: (ctx, arg) => openHelp(ctx, requestedPage(arg) ?? ENTRY_PAGES.contents) },
  'ed.help.context': {
    // F1 reaches this command only while the editor has the focus; with the focus elsewhere the
    // key goes on to `ed.help.help` (W3 errata, entry 8).
    enabled: () => editorHasFocus(),
    run: (ctx) => {
      const context = readEditorWordContext();
      if (context === null) return openHelp(ctx);
      const page = editorHelpPage(context);
      if (page !== null) openHelp(ctx, page); // null: the caret is at the very start; the original does nothing
    },
  },
  'ed.help.about': { run: (ctx) => void ctx.dialogs.open('about.editor', {}) },
  'sim.help.help': { run: (ctx, arg) => openHelp(ctx, requestedPage(arg) ?? ENTRY_PAGES.simulator) },
  'sim.help.context': {
    run: (ctx) => openHelp(ctx, simulatorHelpPage(panelOf(globalThis.document?.activeElement))),
  },
  'sim.help.about': { run: (ctx) => void ctx.dialogs.open('about.sim', {}) },
  'app.help.examples': { run: (ctx) => showExamples(ctx) },
  'app.help.differences': { run: (ctx) => openHelp(ctx, ENTRY_PAGES.differences) },
};
