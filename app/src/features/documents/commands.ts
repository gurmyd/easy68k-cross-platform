// The document commands of Editor mode (ARCHITECTURE.md 1.3.1, 9.7: E1's ids).
//
//   ed.file.new        New X68 Source File (editor-ui §12.1)
//   ed.file.open       Open File... : the Open dialog, then each chosen file (editor-ui §6.2)
//   ed.file.save       Save, or Save As for a document without a name (editor-ui §6.4)
//   ed.file.saveAs     Save As...
//   ed.file.close      Close File: the active document, with the close prompt (editor-ui §6.6)
//   ed.file.exit       Exit: every close prompt, then quit (desktop) or the exit screen (web, 1.4 note 4)
//   ed.edit.reload     Reload File (editor context menu, editor-ui §6.5)
//   ed.window.select   Window menu entry `<n> <name>` (arg: index): activate that document
//
// Enabled state is computed from the active document (editor-ui §19.3), not from the original's
// frame-wide flags: Save, Save As and Close need an active document, Reload one with a name.
//
// Owner: E1.

import type { AppContext, AppState, CommandHandler, CommandId } from '../../contracts';
import { OPEN_FILTERS, OPEN_TITLE } from '../../core/documents/messages';
import { dirname } from '../../core/paths/winpath';
import { showExitScreen } from '../../state/shell';

const activeOf = (state: AppState) => state.documents.items.find((doc) => doc.id === state.documents.activeId) ?? null;
const hasActive = (state: AppState) => activeOf(state) !== null;

/** Exit (editor-ui §1.3; 1.4 note 4): close prompts; then stop logs and quit or show the exit screen. */
export async function exitApplication(ctx: AppContext): Promise<boolean> {
  if (!(await ctx.documents.closeAll())) return false;
  try {
    await ctx.sim.log.exit();
  } catch {
    // The log is the simulator's; a failure there does not keep the window open.
  }
  if (ctx.platform.kind === 'desktop') ctx.platform.quit();
  else showExitScreen(ctx);
  return true;
}

/** Open File...: the dialog (several files may be chosen, an addition), then each in order. */
export async function openFromDialog(ctx: AppContext): Promise<void> {
  const active = ctx.documents.active();
  const paths = await ctx.fileDialogs.open({
    title: OPEN_TITLE,
    filters: [...OPEN_FILTERS],
    multiple: true,
    ...(active?.path ? { startDir: dirname(active.path) } : {}),
  });
  if (!paths) return;
  for (const path of paths) await ctx.documents.open(path);
}

export const documentCommands: Record<CommandId, CommandHandler> = {
  'ed.file.new': {
    run: (ctx) => void ctx.documents.newSource(),
  },
  'ed.file.open': {
    run: (ctx) => openFromDialog(ctx),
  },
  'ed.file.save': {
    run: async (ctx) => {
      const active = ctx.documents.active();
      if (active) await ctx.documents.save(active.id);
    },
    enabled: hasActive,
  },
  'ed.file.saveAs': {
    run: async (ctx) => {
      const active = ctx.documents.active();
      if (active) await ctx.documents.saveAs(active.id);
    },
    enabled: hasActive,
  },
  'ed.file.close': {
    run: async (ctx) => {
      const active = ctx.documents.active();
      if (active) await ctx.documents.close(active.id);
    },
    enabled: hasActive,
  },
  'ed.file.exit': {
    run: (ctx) => exitApplication(ctx).then(() => {}),
  },
  'ed.edit.reload': {
    run: async (ctx) => {
      const active = ctx.documents.active();
      if (active) await ctx.documents.reload(active.id);
    },
    enabled: (state) => activeOf(state)?.hasName === true,
  },
  'ed.window.select': {
    run: (ctx, arg) => {
      const doc = ctx.store.getState().documents.items[Number(arg)];
      if (doc) ctx.documents.activate(doc.id);
    },
    enabled: (state) => state.documents.items.length > 0,
    checked: (state, _ctx, arg) => {
      const doc = state.documents.items[Number(arg)];
      return doc !== undefined && doc.id === state.documents.activeId;
    },
  },
};
