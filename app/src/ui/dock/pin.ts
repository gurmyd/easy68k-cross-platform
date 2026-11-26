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

/** What a person does that ends holdLeftEdge: a press, a key, the wheel, a touch. */
export const PERSON_ACTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * P9.8 point 1 (errata M1 entry 19): a window that an arrangement has just placed shows its content
 * from its left edge until a person acts. While nobody has pressed, typed or turned the wheel, a
 * sideways scroll inside such a window can only come from the page itself: the focus is put back on
 * a field at the right of a window narrower than its content (by the menu that closes, by the dock
 * after it has moved the panel), and the browser scrolls the field into view, or the panel's own
 * reveal does. That happens some frames after the arrangement; how many is the machine's, so the
 * left edge is held by rule and not for a time:
 *
 *   - when the focus arrives anywhere while the hold lasts, `reset` (which puts back every sideways
 *     offset inside the held windows) runs as soon as the script that moved the focus has returned:
 *     in the same task, before anything is drawn and before anything else can read the offsets;
 *   - a sideways scroll that comes another way is put back from its scroll event, before the frame
 *     after it is drawn.
 *
 * The first action of a person, anywhere in `root`, ends the hold: from then on the panel scrolls as
 * every panel does, the reveal of a field reached with Tab included.
 *
 * `held` says whether an element lies in such a window; `onEnd` is called once when the hold ends.
 * Returns the function that ends it (an action of a person calls the same).
 */
export function holdLeftEdge(
  root: EventTarget,
  held: (element: Scrollable) => boolean,
  reset: () => void,
  onEnd: () => void,
): () => void {
  let over = false;
  const onScroll = (event: Event) => {
    const target = event.target;
    if (isScrollable(target) && target.scrollLeft !== 0 && held(target)) target.scrollLeft = 0;
  };
  const onFocusIn = () => {
    queueMicrotask(() => {
      if (!over) reset();
    });
  };
  const end = () => {
    if (over) return;
    over = true;
    root.removeEventListener('scroll', onScroll, { capture: true });
    root.removeEventListener('focusin', onFocusIn, { capture: true });
    for (const type of PERSON_ACTS) root.removeEventListener(type, end, { capture: true });
    onEnd();
  };
  root.addEventListener('scroll', onScroll, { capture: true });
  root.addEventListener('focusin', onFocusIn, { capture: true });
  for (const type of PERSON_ACTS) root.addEventListener(type, end, { capture: true });
  return end;
}
