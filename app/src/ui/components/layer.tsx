// Where floating content (menus, tool-tips, list pop-ups) is mounted. Owner: W2.
//
// Pop-ups render through a portal so that no panel's overflow clips them. By
// default the portal target is document.body. Inside a Dialog it is the
// dialog's own element, so that a pop-up opened from a modal dialog stays
// inside the dialog's focus trap (Dialog.tsx provides the context).

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const LayerContext = createContext<HTMLElement | null>(null);

/**
 * Renders `children` into the current layer (document.body outside dialogs),
 * in the same render, so a menu opened by a key has the focus before the next
 * key arrives. Nothing on the server (the kit is never hydrated).
 */
export function Portal({ children }: { children: ReactNode }) {
  const layer = useContext(LayerContext);
  if (typeof document === 'undefined') return null;
  return createPortal(children, layer ?? document.body);
}
