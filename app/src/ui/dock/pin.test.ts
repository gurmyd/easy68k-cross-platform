// P9.9 point 1: the dock never scrolls as a whole. The rule without a page: which elements are put
// back (pin.ts), and that the dock's stylesheet makes the dock and a floating window unscrollable.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PERSON_ACTS, PINNED_SELECTOR, holdLeftEdge, pinScroll, unscroll, type Scrollable } from './pin';

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

describe('holdLeftEdge (errata M1 entry 19): a placed window shows its left edge until a person acts', () => {
  /** A scroll event of `target` as `root` sees it on the way down. */
  const scrollOf = (root: EventTarget, target: Scrollable) => {
    const event = new Event('scroll');
    Object.defineProperty(event, 'target', { value: target });
    root.dispatchEvent(event);
  };

  it('puts a sideways scroll inside a held window back, whenever it comes, and leaves the rest', () => {
    const page = new EventTarget();
    const area = element(['.e68-hw-scroll'], 0, 0);
    const other = element(['.e68-memory__rows'], 0, 0);
    let ended = 0;
    holdLeftEdge(
      page,
      (target) => target === area,
      () => ended++,
    );
    // The focus is put back on a field at the right, some frames later: the panel reveals it.
    area.scrollLeft = 30;
    scrollOf(page, area);
    expect(area.scrollLeft).toBe(0);
    // Later still (a slow machine), and again: the same.
    area.scrollLeft = 34;
    scrollOf(page, area);
    expect(area.scrollLeft).toBe(0);
    // Up and down is the panel's own (the Log follows its end): kept.
    area.scrollTop = 120;
    scrollOf(page, area);
    expect([area.scrollLeft, area.scrollTop]).toEqual([0, 120]);
    // A window that floated already, or a docked panel: not held.
    other.scrollLeft = 80;
    scrollOf(page, other);
    expect(other.scrollLeft).toBe(80);
    expect(ended).toBe(0);
  });

  it('ends with the first action of a person, once; the panel then scrolls as every panel does', () => {
    expect([...PERSON_ACTS]).toEqual(['pointerdown', 'keydown', 'wheel', 'touchstart']);
    for (const act of PERSON_ACTS) {
      const page = new EventTarget();
      const area = element(['.e68-hw-scroll'], 0, 0);
      let ended = 0;
      holdLeftEdge(
        page,
        () => true,
        () => ended++,
      );
      page.dispatchEvent(new Event(act));
      page.dispatchEvent(new Event(act));
      expect(ended, act).toBe(1);
      // Tab went to the field at the right and the panel revealed it: it stays revealed.
      area.scrollLeft = 30;
      scrollOf(page, area);
      expect(area.scrollLeft, act).toBe(30);
    }
  });

  it('is ended by its own function too (the next arrangement, the dock going away), once', () => {
    const page = new EventTarget();
    const area = element(['.e68-hw-scroll'], 0, 0);
    let ended = 0;
    const end = holdLeftEdge(
      page,
      () => true,
      () => ended++,
    );
    end();
    end();
    page.dispatchEvent(new Event('keydown'));
    expect(ended).toBe(1);
    area.scrollLeft = 12;
    scrollOf(page, area);
    expect(area.scrollLeft).toBe(12);
  });
});
