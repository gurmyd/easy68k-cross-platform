// The dock layout commands (ARCHITECTURE-PLUS P3.1.4): app.layout.move with the dialog layout.move,
// app.layout.lock, app.layout.reset. Owner: N0 > N1.
//
//   Move Panel To...   Editor: Window menu; Simulator: View menu. Opens the dialog `layout.move`
//                      on the focused panel (or the argument's `panel`); OK moves the panel with
//                      one action of the dock and puts the focus into it. Enabled in Editor and
//                      Simulator mode, locked or not.
//   Lock Layout        a check: the lock of the dock (on by default, D2); locked, only today's tab
//                      strips are shown and nothing can be dragged.
//   Reset Layout       the mode's default arrangement; panel visibility and the lock are kept.
//
// The feature reaches the dock only through state/dock.ts (P2.4).

import type { AppContext, CommandHandler, CommandId, FeatureModule } from '../../contracts';
import { dockOf } from '../../state/dock';
import { panelOf } from '../../state/panels';
import type { MoveResult } from './model';
import { MoveDialog, type MoveDialogProps } from './MoveDialog';
import { MOVE_DIALOG_ID } from './texts';

/** In Editor and Simulator mode (EASyBIN has nothing to arrange, P3.1.1). */
const inDockMode = (state: { mode: string }) => state.mode === 'editor' || state.mode === 'simulator';

/** Opens `Move Panel To...` and makes the move. Resolves to the move, or null for Cancel. */
export async function openMoveDialog(ctx: AppContext, arg?: unknown): Promise<MoveResult | null> {
  const dock = dockOf(ctx);
  const panels = dock.describe();
  if (panels.length === 0) return null;
  const asked = typeof arg === 'object' && arg !== null ? (arg as { panel?: unknown }).panel : undefined;
  const focused = panelOf(globalThis.document?.activeElement ?? null);
  const initial = typeof asked === 'string' ? asked : focused;
  const result = await ctx.dialogs.open<MoveDialogProps, MoveResult | null>(MOVE_DIALOG_ID, { panels, initial });
  if (result) dock.move(result.panel, result.target);
  return result ?? null;
}

const COMMANDS: Record<string, CommandHandler> = {
  'app.layout.move': {
    run: (ctx, arg) => openMoveDialog(ctx, arg).then(() => undefined),
    enabled: inDockMode,
  },
  'app.layout.lock': {
    run: (ctx) => {
      const dock = dockOf(ctx);
      dock.setLocked(!dock.locked());
    },
    enabled: inDockMode,
    checked: (_state, ctx) => dockOf(ctx).locked(),
  },
  'app.layout.reset': {
    run: (ctx) => dockOf(ctx).reset(),
    enabled: inDockMode,
  },
};

export const feature: FeatureModule = {
  id: 'layout',
  commands: COMMANDS as Record<CommandId, CommandHandler>,
  dialogs: { [MOVE_DIALOG_ID]: MoveDialog },
};
