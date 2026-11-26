// Bringing a focused field into view inside the Memory panel's scroll areas (version 1.1,
// erratum U2 S7). Owner: U2.
//
// When the panel's region is smaller than what it holds (a narrow column, a small floating
// window), its areas scroll; a control that gets the focus is shown by setting the area's
// own scroll offsets. Never `scrollIntoView`: in Chromium it moves the page's starting point for
// the Tab key (errata N1 26), and it could scroll the dock's own boxes.
//
//   revealScroll(view, scroll, target, margin?)   the offsets that show `target` (pure)
//   revealInArea(area, target)                    applies them to `area`

/** A box in the page's coordinates (getBoundingClientRect). */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where an area must scroll so that `target` is in view inside `view` (the area's visible box),
 * with `margin` px around it where there is room; unchanged when it is in view already. A target
 * larger than the view shows its top and left edge.
 */
export function revealScroll(
  view: Box,
  scroll: { top: number; left: number },
  target: Box,
  margin = 4,
): { top: number; left: number } {
  const axis = (start: number, size: number, viewStart: number, viewSize: number, current: number): number => {
    const before = start - viewStart;
    const after = start + size - (viewStart + viewSize);
    if (before < 0) return Math.max(0, current + before - margin);
    if (after > 0) {
      const by = size + 2 * margin > viewSize ? before - margin : after + margin;
      return Math.max(0, current + Math.max(0, by));
    }
    return current;
  };
  return {
    top: Math.round(axis(target.top, target.height, view.top, view.height, scroll.top)),
    left: Math.round(axis(target.left, target.width, view.left, view.width, scroll.left)),
  };
}

/** Scrolls `area` (and nothing else) so that `target`, an element inside it, is in view. */
export function revealInArea(area: HTMLElement, target: Element): void {
  if (target === area || !area.contains(target)) return;
  const box = area.getBoundingClientRect();
  const next = revealScroll(
    {
      top: box.top + area.clientTop,
      left: box.left + area.clientLeft,
      width: area.clientWidth,
      height: area.clientHeight,
    },
    { top: area.scrollTop, left: area.scrollLeft },
    target.getBoundingClientRect(),
  );
  if (next.top !== area.scrollTop) area.scrollTop = next.top;
  if (next.left !== area.scrollLeft) area.scrollLeft = next.left;
}
