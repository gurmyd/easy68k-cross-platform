// What the dock lets FlexLayout do (ARCHITECTURE-PLUS P1.1 rule 4, P2.2 `onAction`). Owner: N1.
//
// Layout.onAction sees every action FlexLayout's own controls make (a tab's x, the Delete key on
// a tab, a drag, a click on a tab, a splitter). Panel visibility is program state (the Hardware
// panel zeroes the switch byte when it is shown), so nothing may remove a panel's tab except
// hidePanel:
//
//   DELETE_TAB of a closable panel   refused; hidePanel(ctx, id) runs instead (it removes the tab)
//   DELETE_TAB of a viewer           refused; the viewer is closed (closeTransient)
//   DELETE_TAB of any other panel    refused
//   DELETE_TABSET                    refused for a group that holds a panel
//   a group action (close all, ...)  the same for each part; refused as a whole if a part is
//   MOVE_NODE while locked           refused (no drag while `Lock Layout` is checked)
//   anything that would maximize, float, pop out, rename, pin or group tabs: refused
//
// decideAction is pure; the dock carries out what it returns.

import { Actions, type Action } from 'flexlayout-react';
import { isClosablePanel, isViewerId } from './model';

export type ActionDecision =
  | { kind: 'allow' }
  | { kind: 'refuse' }
  /** Refused; the dock hides these panels with hidePanel and closes these viewers instead. */
  | { kind: 'hide'; panels: string[]; viewers: string[] };

export interface DecisionContext {
  locked: boolean;
  /** The panel of a tab id, or null. */
  panelOf(tabId: string): string | null;
  /** The panels of a group, or null when the id is not a group. */
  groupPanels(tabsetId: string): readonly string[] | null;
}

const ALLOWED: ReadonlySet<string> = new Set([
  Actions.SELECT_TAB,
  Actions.SET_ACTIVE_TABSET,
  Actions.ADJUST_WEIGHTS,
  Actions.UPDATE_NODE_ATTRIBUTES,
  Actions.UPDATE_MODEL_ATTRIBUTES,
]);

export function decideAction(action: Action, context: DecisionContext): ActionDecision {
  if (action.type === Actions.GROUP) {
    const parts = ((action as Action & { actions?: Action[] }).actions ?? []).map((part) =>
      decideAction(part, context),
    );
    if (parts.length === 0 || parts.some((part) => part.kind === 'refuse')) return { kind: 'refuse' };
    const hides = parts.filter((part): part is Extract<ActionDecision, { kind: 'hide' }> => part.kind === 'hide');
    if (hides.length === 0) return { kind: 'allow' };
    return {
      kind: 'hide',
      panels: hides.flatMap((part) => part.panels),
      viewers: hides.flatMap((part) => part.viewers),
    };
  }
  if (action.type === Actions.DELETE_TAB) {
    const panel = context.panelOf(String(action.data.node));
    if (panel === null) return { kind: 'refuse' };
    if (isViewerId(panel)) return { kind: 'hide', panels: [], viewers: [panel] };
    if (isClosablePanel(panel)) return { kind: 'hide', panels: [panel], viewers: [] };
    return { kind: 'refuse' };
  }
  if (action.type === Actions.DELETE_TABSET) {
    const panels = context.groupPanels(String(action.data.node));
    return panels !== null && panels.length === 0 ? { kind: 'allow' } : { kind: 'refuse' };
  }
  if (action.type === Actions.MOVE_NODE) return context.locked ? { kind: 'refuse' } : { kind: 'allow' };
  return ALLOWED.has(action.type) ? { kind: 'allow' } : { kind: 'refuse' };
}

/** P2.2 `setOnAllowDrop`: the Output panel is never dropped into a place smaller than 160 x 120 px. */
export const OUTPUT_MIN_DROP = { width: 160, height: 120 } as const;

export function allowsDrop(
  draggedPanels: readonly string[],
  target: { width: number; height: number },
  locked: boolean,
): boolean {
  if (locked) return false;
  if (draggedPanels.includes('output')) {
    return target.width >= OUTPUT_MIN_DROP.width && target.height >= OUTPUT_MIN_DROP.height;
  }
  return true;
}
