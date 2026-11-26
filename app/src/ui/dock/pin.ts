// The dock never scrolls as a whole (ARCHITECTURE-PLUS P9.9 point 1). Owner: M1.
//
// A floating window that lies partly outside the dock is cut at the dock's edge. dock.css makes the
// dock's root and each floating window `overflow: clip` where the engine has it (Chromium, Safari
// 16 and later), so that neither the focus, nor scrollIntoView, nor a script can scroll them. This
// is the second line, for an engine without `clip` (there they are `overflow: hidden`, which a
// script and the focus can scroll): a scroll of the dock's root, of FlexLayout's layer that holds
// the windows, or of a floating window itself is put back at once. A panel's own scrolling (its
// content, `.flexlayout__tab_moveable`, its lists) is not touched: those scroll on purpose and
// only themselves.

/** What pinScroll needs of an element (a DOM element; a plain object in the unit tests). */
export interface Scrollable {
  scrollLeft: number;
  scrollTop: number;
  matches(selector: string): boolean;
}

/** The elements between the page and a floating window that never scroll: the root is the dock's. */
export const PINNED_SELECTOR = '[data-e68-dock], .flexlayout__layout, .flexlayout__tab[data-e68-float]';

/** Puts a pinned element's scroll offsets back to 0; true when it had to. */
export function unscroll(element: Scrollable): boolean {
  if (!element.matches(PINNED_SELECTOR)) return false;
  let moved = false;
  if (element.scrollLeft !== 0) {
    element.scrollLeft = 0;
    moved = true;
  }
  if (element.scrollTop !== 0) {
    element.scrollTop = 0;
    moved = true;
  }
  return moved;
}

const isScrollable = (target: unknown): target is Scrollable =>
  typeof target === 'object' &&
  target !== null &&
  typeof (target as Scrollable).matches === 'function' &&
  typeof (target as Scrollable).scrollLeft === 'number';

/**
 * Follows the scroll events below `root` (a scroll does not bubble, but it is seen on the way down)
 * and puts back every pinned element that scrolled. Returns the function that stops it.
 */
export function pinScroll(root: EventTarget & Scrollable): () => void {
  const onScroll = (event: Event) => {
    if (isScrollable(event.target)) unscroll(event.target);
  };
  root.addEventListener('scroll', onScroll, { capture: true });
  unscroll(root);
  return () => root.removeEventListener('scroll', onScroll, { capture: true });
}
