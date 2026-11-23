// The choices of the dialog `layout.move` (ARCHITECTURE-PLUS P3.1.4), pure. Owner: N1.
//
//   Panel:   the visible panels of the mode by title, open viewers included; it starts on the
//            panel that holds the focus (or the command's `panel` argument), else the first
//   Place:   ( ) Into the group of [ panel ] as a tab
//            ( ) Beside [ panel ]: [ Left | Right | Above | Below ]
//            ( ) At the edge of the window: [ Left | Right | Top | Bottom ]
// The second list of the first two choices lists the other visible panels.

import type { DockMoveTarget } from '../../state/dock';

export interface DescribedPanel {
  panel: string;
  title: string;
  group: number;
}

export type BesideSide = 'left' | 'right' | 'above' | 'below';
export type EdgeSide = 'left' | 'right' | 'top' | 'bottom';

export interface MoveChoice {
  panel: string;
  place: 'tab' | 'beside' | 'edge';
  near: string;
  beside: BesideSide;
  edge: EdgeSide;
}

export interface MoveResult {
  panel: string;
  target: DockMoveTarget;
}

/** The panels of the second list: every visible panel but `panel`. */
export function otherPanels(panels: readonly DescribedPanel[], panel: string): DescribedPanel[] {
  return panels.filter((entry) => entry.panel !== panel);
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

/** What OK does, or null when the choice names no panel to move beside or into. */
export function resultOf(choice: MoveChoice): MoveResult | null {
  if (choice.panel === '') return null;
  if (choice.place === 'edge') return { panel: choice.panel, target: { kind: 'edge', side: choice.edge } };
  if (choice.near === '' || choice.near === choice.panel) return null;
  if (choice.place === 'tab') return { panel: choice.panel, target: { kind: 'tab', near: choice.near } };
  return { panel: choice.panel, target: { kind: 'beside', near: choice.near, side: choice.beside } };
}
