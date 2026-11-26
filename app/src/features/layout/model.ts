// The choices of the dialog `layout.move` (ARCHITECTURE-PLUS P3.1.4, P9.2), pure. Owner: N1; the
// fourth place is version 1.1's (M2).
//
//   Panel:   the visible panels of the mode by title, open viewers and floating panels included;
//            it starts on the panel that holds the focus (or the command's `panel` argument), else
//            the first
//   Place:   ( ) Into the group of [ panel ] as a tab
//            ( ) Beside [ panel ]: [ Left | Right | Above | Below ]
//            ( ) At the edge of the window: [ Left | Right | Top | Bottom ]
//            ( ) As a floating window                                    (version 1.1, P9.2)
// The second list of the first two choices lists the other visible panels that are docked: a
// floating panel is no target of a move (describe(), state/dock.ts). A floating panel moved to one
// of the first three places is docked there; `As a floating window` is offered for a panel that
// floats already (OK then changes nothing) or can float (canFloat: not the last docked panel).

import type { DockMoveTarget } from '../../state/dock';

export interface DescribedPanel {
  panel: string;
  title: string;
  group: number;
  /** Version 1.1: the panel is a floating window (describe() lists it after the docked ones). */
  floating?: true;
}

export type BesideSide = 'left' | 'right' | 'above' | 'below';
export type EdgeSide = 'left' | 'right' | 'top' | 'bottom';
export type MovePlace = 'tab' | 'beside' | 'edge' | 'float';

export interface MoveChoice {
  panel: string;
  place: MovePlace;
  near: string;
  beside: BesideSide;
  edge: EdgeSide;
}

export type MoveResult = { panel: string; target: DockMoveTarget } | { panel: string; float: true };

/** The panels of the second list: every docked visible panel but `panel`. */
export function otherPanels(panels: readonly DescribedPanel[], panel: string): DescribedPanel[] {
  return panels.filter((entry) => entry.panel !== panel && entry.floating !== true);
}

/** Whether `As a floating window` can be chosen for `panel`: it floats already or can float now. */
export function canChooseFloat(
  panels: readonly DescribedPanel[],
  floatable: readonly string[],
  panel: string,
): boolean {
  const entry = panels.find((item) => item.panel === panel);
  return entry !== undefined && (entry.floating === true || floatable.includes(panel));
}

/** The dialog's first state. */
export function initialChoice(panels: readonly DescribedPanel[], initial?: string | null): MoveChoice {
  const panel = panels.find((entry) => entry.panel === initial)?.panel ?? panels[0]?.panel ?? '';
  return { panel, place: 'tab', near: otherPanels(panels, panel)[0]?.panel ?? '', beside: 'left', edge: 'left' };
}

/** A new panel in the first list: the second list keeps its choice unless it is the panel itself. */
export function withPanel(panels: readonly DescribedPanel[], choice: MoveChoice, panel: string): MoveChoice {
  const others = otherPanels(panels, panel);
  const near = others.some((entry) => entry.panel === choice.near) ? choice.near : (others[0]?.panel ?? '');
  return { ...choice, panel, near };
}

/**
 * What OK does, or null when the choice names no panel to move beside or into, or the panel cannot
 * float (`floatable`: the panels that can float now, DockController.canFloat).
 */
export function resultOf(
  choice: MoveChoice,
  panels: readonly DescribedPanel[] = [],
  floatable: readonly string[] = [],
): MoveResult | null {
  if (choice.panel === '') return null;
  if (choice.place === 'float') {
    return canChooseFloat(panels, floatable, choice.panel) ? { panel: choice.panel, float: true } : null;
  }
  if (choice.place === 'edge') return { panel: choice.panel, target: { kind: 'edge', side: choice.edge } };
  if (choice.near === '' || choice.near === choice.panel) return null;
  if (choice.place === 'tab') return { panel: choice.panel, target: { kind: 'tab', near: choice.near } };
  return { panel: choice.panel, target: { kind: 'beside', near: choice.near, side: choice.beside } };
}
