// Placement of pop-ups (menus, sub-menus, tool-tips) next to their anchor.
// Owner: W2. Pure arithmetic, tested under Node.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * - 'below': under the anchor, left edges aligned (menu-bar menus, lists);
 *   flips above when there is no room below.
 * - 'right': beside the anchor, top edges aligned (sub-menus); flips to the left.
 * - 'point': at the anchor's top-left corner (context menus); flips left / up.
 * - 'tooltip': under the anchor, centred; flips above.
 */
export type Placement = 'below' | 'right' | 'point' | 'tooltip';

const GAP = { below: 2, right: -4, point: 0, tooltip: 6 } as const;
/** Distance kept from the viewport edge. */
export const VIEWPORT_MARGIN = 4;

/** The top-left corner of a pop-up of `size` for `anchor`, kept inside `viewport`. */
export function placePopup(anchor: Box, size: Size, viewport: Size, placement: Placement): { x: number; y: number } {
  const gap = GAP[placement];
  let x: number;
  let y: number;
  switch (placement) {
    case 'below':
    case 'tooltip': {
      x = placement === 'below' ? anchor.x : anchor.x + anchor.width / 2 - size.width / 2;
      y = anchor.y + anchor.height + gap;
      if (y + size.height > viewport.height - VIEWPORT_MARGIN && anchor.y - gap - size.height >= VIEWPORT_MARGIN) {
        y = anchor.y - gap - size.height;
      }
      break;
    }
    case 'right': {
      x = anchor.x + anchor.width + gap;
      y = anchor.y - 4; // the first item lines up with the parent item
      if (x + size.width > viewport.width - VIEWPORT_MARGIN && anchor.x - gap - size.width >= VIEWPORT_MARGIN) {
        x = anchor.x - size.width - gap;
      }
      break;
    }
    case 'point': {
      x = anchor.x;
      y = anchor.y;
      if (x + size.width > viewport.width - VIEWPORT_MARGIN && x - size.width >= VIEWPORT_MARGIN) x -= size.width;
      if (y + size.height > viewport.height - VIEWPORT_MARGIN && y - size.height >= VIEWPORT_MARGIN) y -= size.height;
      break;
    }
  }
  return {
    x: clamp(x, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN - size.width)),
    y: clamp(y, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.height - VIEWPORT_MARGIN - size.height)),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
