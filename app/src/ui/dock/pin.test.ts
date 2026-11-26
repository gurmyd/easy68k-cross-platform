// P9.9 point 1: the dock never scrolls as a whole. The rule without a page: which elements are put
// back (pin.ts), and that the dock's stylesheet makes the dock and a floating window unscrollable.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PINNED_SELECTOR, pinScroll, unscroll, type Scrollable } from './pin';

/** An element as pinScroll sees it: its offsets and the selectors it matches. */
function element(matches: string[], left = 0, top = 0): Scrollable & EventTarget {
  const target = new EventTarget() as Scrollable & EventTarget;
  target.scrollLeft = left;
  target.scrollTop = top;
  target.matches = (selector: string) => selector.split(',').some((part) => matches.includes(part.trim()));
  return target;
}

describe('pin.ts', () => {
  it('pins the dock root, the layer of the windows and a floating window, and nothing else', () => {
    expect(PINNED_SELECTOR.split(',').map((part) => part.trim())).toEqual([
      '[data-e68-dock]',
      '.flexlayout__layout',
      '.flexlayout__tab[data-e68-float]',
    ]);
    const dock = element(['[data-e68-dock]'], 412, 3);
    expect(unscroll(dock)).toBe(true);
    expect([dock.scrollLeft, dock.scrollTop]).toEqual([0, 0]);
    const window = element(['.flexlayout__tab[data-e68-float]'], 0, 30);
    expect(unscroll(window)).toBe(true);
    expect(window.scrollTop).toBe(0);
    // A panel's own scrolling (its content, a list) scrolls on purpose and only itself.
    const content = element(['.flexlayout__tab_moveable'], 24, 100);
    expect(unscroll(content)).toBe(false);
    expect([content.scrollLeft, content.scrollTop]).toEqual([24, 100]);
    expect(unscroll(element(['[data-e68-dock]']))).toBe(false);
  });

  it('pinScroll puts a scrolled pinned element back at once, from the scroll event, and stops when asked', () => {
    const dock = element(['[data-e68-dock]'], 5, 0);
    const stop = pinScroll(dock);
    expect(dock.scrollLeft, 'put back when it starts').toBe(0);
    dock.scrollLeft = 357;
    dock.dispatchEvent(new Event('scroll'));
    expect(dock.scrollLeft).toBe(0);
    // A scroll of a panel's list below the dock: left as it is.
    const list = element(['.e68-hw-scroll'], 28, 0);
    const event = new Event('scroll');
    Object.defineProperty(event, 'target', { value: list });
    dock.dispatchEvent(event);
    expect(list.scrollLeft).toBe(28);
    stop();
    dock.scrollLeft = 40;
    dock.dispatchEvent(new Event('scroll'));
    expect(dock.scrollLeft, 'no longer followed').toBe(40);
  });

  it("dock.css: the dock's root and a floating window clip, so that neither is a scroll container", () => {
    const css = readFileSync(new URL('./dock.css', import.meta.url), 'utf8');
    const supports = [...css.matchAll(/@supports \(overflow: clip\) \{([^@]*?)\n\}/g)].map((match) => match[1]!);
    const clipped = supports.flatMap((block) =>
      [...block.matchAll(/([^{}]+)\{\s*overflow: clip;\s*\}/g)].map((rule) => rule[1]!.trim()),
    );
    expect(clipped).toEqual(['.e68-dock', '.e68-dock .flexlayout__tab[data-e68-float]']);
  });
});
