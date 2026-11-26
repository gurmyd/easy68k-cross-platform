// The dock layout commands (ARCHITECTURE-PLUS P3.1.4): app.layout.move with the dialog layout.move,
// app.layout.lock, app.layout.reset. Owner: N0 > N1; version 1.1 (P9.2 to P9.5): M2.
//
//   Move Panel To...   Editor: Window menu; Simulator: View menu. Opens the dialog `layout.move`
//                      on the focused panel (or the argument's `panel`); OK moves the panel with
//                      one action of the dock, or makes it float (`As a floating window`, 1.1),
//                      and puts the focus into it. Enabled in Editor and Simulator mode, locked or
//                      not.
//   Lock Layout        a check: the lock of the dock (on by default, D2); locked, only today's tab
//                      strips are shown and nothing can be dragged. The toolbar's `Arrange Panels`
//                      (1.1, P9.3) is this command with its check inverted.
//   Reset Layout       the mode's default arrangement; panel visibility and the lock are kept.
//
// Version 1.1:
//   Float, Dock        app.layout.float and app.layout.dock: M1's handlers (DOCK_COMMANDS of
//                      state/dock.ts), registered here because a handler comes from a feature
//   View > Layouts     sim.view.layout.classic, .wideOutput, .sideBySide, .floatingTools: the
//                      ready-made arrangements of the Simulator (arrangements.ts); each sets the
//                      place of every panel, shows and hides none and keeps the lock
//   the tip            once per browser profile, above the Simulator's status bar (ArrangeTip.tsx)
//
// The feature reaches the dock only through state/dock.ts (P2.4).

import type { AppContext, CommandHandler, CommandId, FeatureModule } from '../../contracts';
import { DOCK_COMMANDS, dockOf } from '../../state/dock';
import { isPanelVisible } from '../../state/layout';
import { panelOf } from '../../state/panels';
import { shellStateOf } from '../../state/shell';
import {
  ARRANGEMENT_COMMANDS,
  ARRANGEMENT_IDS,
  arrangementPlan,
  type ArrangementId,
  type DockArea,
} from './arrangements';
import { watchArrangeTip } from './ArrangeTip';
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
  const floatable = panels.filter((entry) => dock.canFloat(entry.panel)).map((entry) => entry.panel);
  const result = await ctx.dialogs.open<MoveDialogProps, MoveResult | null>(MOVE_DIALOG_ID, {
    panels,
    initial,
    floatable,
  });
  if (result && 'float' in result) dock.float(result.panel);
  else if (result) dock.move(result.panel, result.target);
  return result ?? null;
}

/**
 * Applies the entry `id` of `View > Layouts` to the Simulator's dock (P9.4). `area` is the dock's
 * size now (Floating Tools places its windows by it); runArrangement measures it.
 */
export function applyArrangement(ctx: AppContext, id: ArrangementId, area: DockArea | null = null): boolean {
  const dock = dockOf(ctx);
  const state = ctx.store.getState();
  const plan = arrangementPlan(id, {
    front: frontToolOf(ctx),
    shown: (panel) => isPanelVisible(state.settings, panel, ctx.platform.kind),
    area,
  });
  if (plan.kind === 'default') {
    dock.reset();
    return true;
  }
  return dock.arrange(plan.arrangement);
}

/** The tool panel in front now: ShellState.activeTool, which the dock keeps in step (P3.1.5). */
function frontToolOf(ctx: AppContext): string | null {
  return shellStateOf(ctx).getState().activeTool;
}

/** The size of the Simulator's dock on the page now, or null (no page, or not laid out). */
function simulatorDockArea(): DockArea | null {
  const element = globalThis.document?.querySelector?.('[data-e68-dock="simulator"]');
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? { width: box.width, height: box.height } : null;
}

/** The next display frame, or 50 ms where none comes (a hidden page). */
const nextFrame = () =>
  new Promise<void>((done) => {
    const timer = setTimeout(done, 50);
    globalThis.requestAnimationFrame?.(() => {
      clearTimeout(timer);
      done();
    });
  });

/** How many frames runArrangement waits at most for the Simulator's dock to be laid out. */
const LAYOUT_FRAMES = 40;

/**
 * Applies the entry `id`, placing Floating Tools by the Simulator dock's own size: when the entry
 * is chosen at the moment the window switches to the Simulator (the dock not laid out yet, or
 * still hidden), it waits for the dock's first layout, so that the windows cascade from the
 * Simulator dock's top right and not from a size of before (erratum M2). Without a page it applies
 * at once.
 */
export async function runArrangement(ctx: AppContext, id: ArrangementId): Promise<boolean> {
  if (id !== 'floatingTools' || typeof globalThis.document === 'undefined') return applyArrangement(ctx, id);
  let area = simulatorDockArea();
  for (let frame = 0; area === null && frame < LAYOUT_FRAMES; frame++) {
    await nextFrame();
    if (ctx.store.getState().mode !== 'simulator') return false;
    area = simulatorDockArea();
  }
  return applyArrangement(ctx, id, area);
}

/** The four entries of View > Layouts: in Simulator mode only (the Editor and EASyBIN have none). */
const ARRANGEMENT_HANDLERS: Record<string, CommandHandler> = Object.fromEntries(
  ARRANGEMENT_IDS.map((id): [string, CommandHandler] => [
    ARRANGEMENT_COMMANDS[id],
    {
      run: (ctx) => runArrangement(ctx, id).then(() => undefined),
      enabled: (state) => state.mode === 'simulator',
    },
  ]),
);

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
  ...DOCK_COMMANDS,
  ...ARRANGEMENT_HANDLERS,
};

export const feature: FeatureModule = {
  id: 'layout',
  commands: COMMANDS as Record<CommandId, CommandHandler>,
  dialogs: { [MOVE_DIALOG_ID]: MoveDialog },
  init: (ctx) => watchArrangeTip(ctx),
};
