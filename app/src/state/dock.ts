// The per-window dock controller (ARCHITECTURE-PLUS P3.1.5, P4.4). Owner: N0 > N1.
//
// state/panels.ts calls it to show, hide and focus panels; features reach the dock only through
// here (the viewer opens its transient tabs with openTransient). It imports neither ui/dock nor
// flexlayout-react: ui/dock/DockWorkspace.tsx attaches the live model to it when it mounts.
//
// STUB of N0: every member does nothing; acceptsTransient() and openTransient() return false,
// locked() returns true (D2), present() false, describe() an empty list. N1 may add members.

import type { ReactNode } from 'react';
import type { AppContext } from '../contracts';

export interface DockController {
  reveal(id: string, options?: { select?: boolean }): void; // showPanel
  park(id: string): void; // hidePanel (never for 'output')
  present(id: string): boolean; // focusPanel: selects its tab
  /** True for N1's controller, also before DockWorkspace has attached a model; false for N0's stub. */
  acceptsTransient(): boolean;
  openTransient(spec: {
    id: `viewer:${number}`;
    title: string;
    tooltip: string;
    render(): ReactNode;
    onClose(): void;
  }): boolean; // false: acceptsTransient() is false
  selectTransient(id: string): boolean;
  closeTransient(id: string): void;
  /** The moves of P3.1.4; `near` is a panel id, `side` a side of P3.1.4's dialog. */
  move(panel: string, target: { kind: 'tab' | 'beside' | 'edge'; near?: string; side?: string }): void;
  setLocked(on: boolean): void;
  /** The lock state, for the check command `app.layout.lock`; N0's stub returns true (D2). */
  locked(): boolean;
  /** Called after any change of the arrangement or the lock (menus refresh their check state). */
  subscribe(listener: () => void): () => void;
  reset(): void;
  /** The visible panels, open viewers included, with their titles and the group each is in, for
   *  the dialog `layout.move` and the tab menu. */
  describe(): { panel: string; title: string; group: number }[];
}

function createStubDockController(): DockController {
  return {
    reveal: () => {},
    park: () => {},
    present: () => false,
    acceptsTransient: () => false,
    openTransient: () => false,
    selectTransient: () => false,
    closeTransient: () => {},
    move: () => {},
    setLocked: () => {},
    locked: () => true,
    subscribe: () => () => {},
    reset: () => {},
    describe: () => [],
  };
}

const controllers = new WeakMap<AppContext, DockController>();

/** The dock controller of the window of `ctx` (one per context). */
export function dockOf(ctx: AppContext): DockController {
  let controller = controllers.get(ctx);
  if (!controller) {
    controller = createStubDockController();
    controllers.set(ctx, controller);
  }
  return controller;
}
